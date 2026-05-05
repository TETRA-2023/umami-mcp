#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, UmamiConfig } from "./config.js";
import { UmamiClient } from "./client.js";
import { registerWebsiteTools } from "./tools/websites.js";
import { registerStatsTools } from "./tools/stats.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerEventTools } from "./tools/events.js";
import { registerReportTools } from "./tools/reports.js";
import { registerUserTools } from "./tools/users.js";
import { registerTeamTools } from "./tools/teams.js";
import { registerRealtimeTools } from "./tools/realtime.js";
import { registerAccountTools } from "./tools/account.js";
import { registerWebsiteResources } from "./resources/websites.js";
import { registerAccountResources } from "./resources/account.js";
import { registerPrompts } from "./prompts/index.js";
import { resolveTransport, runHttp, runStdio } from "./transport.js";

export function buildServer(client: UmamiClient): McpServer {
  const server = new McpServer({
    name: "umami-mcp",
    version: "0.1.3",
  });

  registerWebsiteTools(server, client);
  registerStatsTools(server, client);
  registerSessionTools(server, client);
  registerEventTools(server, client);
  registerReportTools(server, client);
  registerUserTools(server, client);
  registerTeamTools(server, client);
  registerRealtimeTools(server, client);
  registerAccountTools(server, client);
  registerWebsiteResources(server, client);
  registerAccountResources(server, client);
  registerPrompts(server);

  return server;
}

const config = loadConfig();
const client = new UmamiClient(config);

async function main(): Promise<void> {
  const transport = resolveTransport();
  // Log to stderr so stdio's stdout JSON-RPC framing stays clean.
  console.error(`[umami-mcp] starting with ${transport} transport`);

  if (transport === "stdio") {
    // Stdio is single-connection; one shared server is fine.
    await runStdio(buildServer(client));
    return;
  }

  // HTTP transports get a per-request server factory — the MCP TS SDK requires
  // fresh server+transport instances per request in stateless mode to avoid
  // request ID collisions across concurrent clients.
  await runHttp(transport, () => buildServer(client));
}

main().catch((err) => {
  console.error("[umami-mcp] fatal:", err);
  process.exit(1);
});

// ── Smithery Sandbox ──
// Retained from upstream so Smithery's hosted execution path keeps working.

export function createSandboxServer(): McpServer {
  const mockConfig: UmamiConfig = {
    baseUrl: "https://example.com",
    username: "",
    password: "",
    apiKey: "",
  };
  const mockClient = new UmamiClient(mockConfig);
  return buildServer(mockClient);
}
