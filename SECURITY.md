# Security Policy

## Reporting a vulnerability

Do not open a public issue. Open a private security advisory on this repository:
[Security → Report a vulnerability](https://github.com/TETRA-2023/umami-mcp/security/advisories/new).
Include the affected version or image digest and the steps to reproduce.

This repository is a fork of [mikusnuz/umami-mcp](https://github.com/mikusnuz/umami-mcp). If the issue is in
code shared with upstream, please report it there as well.

## Supported versions

Only the latest release receives fixes.

## Scope

The server exposes the Umami API (websites, stats, events, sessions, reports, users, teams) through MCP
tools.

- **HTTP transports** (`streamable-http`, `sse`): set `MCP_BEARER_TOKEN` whenever the server is reachable
  by anything other than the local machine. The bearer is compared in constant time, and the missing and
  wrong-token cases return the same 401. Without it, the HTTP endpoint is open.
- **Bind address**: `MCP_HOST` defaults to `127.0.0.1`. Bind to all interfaces only behind the bearer and
  an authenticating gateway, with TLS in front.
- **Credentials**: never commit `.env` files or Umami credentials; inject them through your platform's
  secret management.

## Out of scope

- Umami itself: report to [umami-software/umami](https://github.com/umami-software/umami).
- Authorisation inside Umami: a tool can do what the configured Umami account can do, including user and
  team administration for an admin account. Use the least privileged account the agent needs.
