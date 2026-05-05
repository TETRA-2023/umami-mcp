/**
 * Transport selection + HTTP runner.
 *
 * Mirrors the shape of homarr-mcp/src/server.py (_resolve_transport / _run):
 * - `stdio` (default) connects an `StdioServerTransport` directly.
 * - `streamable-http` / `sse` build an Express app, mount the bearer
 *   middleware when `MCP_BEARER_TOKEN` is set, and listen on `MCP_HOST`:`MCP_PORT`.
 */

import express from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import { bearerAuth } from "./auth.js";

export const VALID_TRANSPORTS = ["stdio", "streamable-http", "sse"] as const;
export type Transport = (typeof VALID_TRANSPORTS)[number];

export function resolveTransport(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): Transport {
  if (argv.includes("--sse")) return "sse";
  if (argv.includes("--streamable-http")) return "streamable-http";

  const envValue = (env.UMAMI_TRANSPORT ?? "").toLowerCase();
  if ((VALID_TRANSPORTS as readonly string[]).includes(envValue)) {
    return envValue as Transport;
  }
  return "stdio";
}

export async function runStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function runHttp(
  transportKind: "streamable-http" | "sse",
  serverFactory: () => McpServer,
  options: {
    host?: string;
    port?: number;
    bearerToken?: string;
    skipPaths?: readonly string[];
  } = {},
): Promise<void> {
  const host = options.host ?? process.env.MCP_HOST ?? "127.0.0.1";
  const port = options.port ?? Number.parseInt(process.env.MCP_PORT ?? "8000", 10);
  const bearerToken = options.bearerToken ?? process.env.MCP_BEARER_TOKEN ?? "";

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  if (bearerToken) {
    app.use(bearerAuth({ expectedToken: bearerToken, skipPaths: options.skipPaths }));
    console.error(`[umami-mcp] bearer-token middleware enabled for ${transportKind}`);
  } else {
    console.error(
      `[umami-mcp] MCP_BEARER_TOKEN not set — ${transportKind} accepts unauthenticated requests`,
    );
  }

  if (transportKind === "streamable-http") {
    // Stateless + JSON-response mode. Per the MCP TS SDK README, stateless
    // mode REQUIRES fresh server+transport instances per request to avoid
    // JSON-RPC request ID collisions when multiple clients connect
    // concurrently. The serverFactory is invoked on every POST.
    //
    // - sessionIdGenerator: undefined → no session bookkeeping
    // - enableJsonResponse: true → reply with one-shot application/json
    //   instead of SSE (event/data) framing
    //
    // This is the gateway-friendly contract; LiteLLM's
    // mcp-rest/tools/list path expects a single JSON response and
    // hangs ('MCP client list_tools was cancelled' in warnings) when
    // the server replies with SSE framing.
    app.post("/mcp", async (req, res) => {
      const server = serverFactory();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        console.error("[umami-mcp] handleRequest error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "internal_error" });
        }
      }
    });
    // GET / DELETE on /mcp are session-management endpoints — stateless
    // mode doesn't use sessions, so reject explicitly.
    const rejectStateful = (_req: express.Request, res: express.Response): void => {
      res.status(405).json({ error: "method_not_allowed" });
    };
    app.get("/mcp", rejectStateful);
    app.delete("/mcp", rejectStateful);
  } else {
    // SSE — legacy transport. Each GET /sse opens an event stream; the
    // matching POST /messages?sessionId=… delivers JSON-RPC payloads.
    // SSE is inherently per-session (long-lived event stream), so we keep
    // a session map here.
    const sessions = new Map<string, { transport: SSEServerTransport; server: McpServer }>();

    app.get("/sse", async (_req, res) => {
      const server = serverFactory();
      const transport = new SSEServerTransport("/messages", res);
      sessions.set(transport.sessionId, { transport, server });
      res.on("close", () => {
        sessions.delete(transport.sessionId);
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
      const sessionId = String(req.query.sessionId ?? "");
      const session = sessions.get(sessionId);
      if (!session) {
        res.status(400).json({ error: "unknown_session" });
        return;
      }
      await session.transport.handlePostMessage(req, res, req.body);
    });
  }

  await new Promise<void>((resolve, reject) => {
    const httpServer = app.listen(port, host, () => {
      console.error(`[umami-mcp] listening on ${host}:${port} (${transportKind})`);
      resolve();
    });
    httpServer.on("error", reject);
  });
}
