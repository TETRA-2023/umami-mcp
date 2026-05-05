# CLAUDE.md — umami-mcp

## Project Overview

MCP server for Umami Analytics. TETRA fork of `mikusnuz/umami-mcp@v1.2.1`
extended with HTTP transport selection and a bearer-token middleware so the
wrapper can sit behind the LiteLLM gateway.

- **Package**: `@tetra-2023/umami-mcp`
- **Node**: >= 20
- **Registry**: `ghcr.io/tetra-2023/umami-mcp`

## Architecture

```
src/
  index.ts        — entrypoint (transport resolution + server bootstrap)
  transport.ts    — stdio | streamable-http | sse runner; bearer-mount logic
  auth.ts         — bearer-token Express middleware (RFC 7235 §2.1)
  client.ts       — UmamiClient: API-key OR JWT auth, fetch-based
  config.ts       — env-driven config loader
  tools/          — 9 tool registrations (websites, stats, sessions, events,
                    reports, users, teams, realtime, account)
  resources/      — websites + account resources
  prompts/        — 2 prompts
```

- `index.ts` calls `resolveTransport()` then dispatches to `runStdio`/`runHttp`.
- `transport.ts` builds an Express app for HTTP transports, mounts
  `bearerAuth` only when `MCP_BEARER_TOKEN` is set, and connects either
  `StreamableHTTPServerTransport` (`/mcp`) or `SSEServerTransport`
  (`/sse` + `/messages`).
- `auth.ts` is the canonical bearer-middleware port from `homarr-mcp/src/auth.py`.
  Constant-time compare; identical 401 body across all failure modes.

## Umami API

- API-key auth: `Authorization: Bearer <api_key>` direct.
- JWT auth: `POST /api/auth/login` with username/password → JWT used as
  `Authorization: Bearer <jwt>`. Cached until expiry minus 5 min.
- Full v2 surface — see `src/client.ts` for the wire shape.

## Development Setup

```bash
npm install
cp .env.example .env  # Configure UMAMI_URL + auth
```

## Running

```bash
npm run dev                                            # tsx, stdio
npm run build && node dist/index.js --streamable-http  # HTTP, port 8000
```

Environment variables: `UMAMI_URL`, `UMAMI_API_KEY` or `UMAMI_USERNAME`+
`UMAMI_PASSWORD`, `UMAMI_TRANSPORT`, `MCP_HOST`, `MCP_PORT`, `MCP_BEARER_TOKEN`.

## Code Conventions

- **TypeScript strict** (tsconfig.json).
- **Module format**: NodeNext / ESM.
- **Commit messages**: Conventional Commits (`feat:`, `fix:`, `chore:`, etc.).
- **Security**: never log tokens. The bearer middleware sends a uniform 401
  for every failure path; do not differentiate.

## Origin

Initial import: `mikusnuz/umami-mcp@v1.2.1` (MIT). LICENSE preserved
verbatim. Disconnected fork — no upstream PRs planned. See README §
"Origin & Acknowledgments".
