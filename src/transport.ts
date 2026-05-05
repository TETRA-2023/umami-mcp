/**
 * Transport selection + HTTP runner.
 *
 * Mirrors the shape of homarr-mcp/src/server.py (_resolve_transport / _run):
 * - `stdio` (default) connects an `StdioServerTransport` directly.
 * - `streamable-http` / `sse` build an Express app, mount the bearer
 *   middleware when `MCP_BEARER_TOKEN` is set, and listen on `MCP_HOST`:`MCP_PORT`.
 */

import { randomUUID } from "node:crypto";
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
  server: McpServer,
  transportKind: "streamable-http" | "sse",
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
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    await server.connect(transport);

    const handle = async (req: express.Request, res: express.Response): Promise<void> => {
      try {
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        console.error("[umami-mcp] handleRequest error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "internal_error" });
        }
      }
    };

    app.post("/mcp", handle);
    app.get("/mcp", handle);
    app.delete("/mcp", handle);
  } else {
    // SSE — legacy transport. Each GET /sse opens an event stream; the
    // matching POST /messages?sessionId=… delivers JSON-RPC payloads.
    const sessions = new Map<string, SSEServerTransport>();

    app.get("/sse", async (_req, res) => {
      const transport = new SSEServerTransport("/messages", res);
      sessions.set(transport.sessionId, transport);
      res.on("close", () => {
        sessions.delete(transport.sessionId);
      });
      await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
      const sessionId = String(req.query.sessionId ?? "");
      const transport = sessions.get(sessionId);
      if (!transport) {
        res.status(400).json({ error: "unknown_session" });
        return;
      }
      await transport.handlePostMessage(req, res, req.body);
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
