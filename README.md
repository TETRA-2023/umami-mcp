# umami-mcp

MCP server for [Umami Analytics](https://umami.is) — query websites, stats,
events, sessions, reports, users, and teams over the Model Context Protocol.

## Features

- **Full Umami v2 API surface** — 66 tools across websites, stats, sessions,
  events, event-data, reports, users, teams, realtime, account.
- **Three transports** — `stdio` (Claude Code / local), `streamable-http`
  (gateway / remote), and legacy `sse`.
- **Bearer-token middleware** — optional `Authorization: Bearer <token>` gate
  for HTTP transports. Constant-time comparison, RFC 7235 §2.1 case-insensitive
  scheme. No-op on stdio so existing local consumers stay compatible.
- **Auth flexibility** — Umami API key (preferred) or username/password JWT
  login.

## Setup

### Prerequisites

- Node.js 20+
- A reachable Umami instance and credentials

### Configuration

```bash
cp .env.example .env
# Edit .env: UMAMI_URL + (UMAMI_API_KEY) or (UMAMI_USERNAME + UMAMI_PASSWORD)
```

| Variable | Description | Default |
| --- | --- | --- |
| `UMAMI_URL` | Umami instance URL (no trailing slash) | *required* |
| `UMAMI_API_KEY` | Umami API key | *one of API key OR user/pass required* |
| `UMAMI_USERNAME` / `UMAMI_PASSWORD` | Self-hosted login credentials | — |
| `UMAMI_TRANSPORT` | `stdio` \| `streamable-http` \| `sse` | `stdio` |
| `MCP_HOST` | Bind address for HTTP transports | `127.0.0.1` |
| `MCP_PORT` | Listen port for HTTP transports | `8000` |
| `MCP_BEARER_TOKEN` | Optional bearer token enforced on HTTP transports (no-op for stdio) | *unset* |

CLI flags `--streamable-http` / `--sse` override `UMAMI_TRANSPORT`.

## Usage

### stdio (Claude Code / local)

```bash
npm install
npm run build
node dist/index.js
```

### streamable-http (Docker / remote)

```bash
node dist/index.js --streamable-http
```

### Claude Code MCP entry

```json
{
  "mcpServers": {
    "umami": {
      "command": "node",
      "args": ["/path/to/umami-mcp/dist/index.js"],
      "env": {
        "UMAMI_URL": "https://your-umami-instance.example",
        "UMAMI_API_KEY": "..."
      }
    }
  }
}
```

### Docker

```bash
docker build -t umami-mcp .
docker run --rm --env-file .env -p 8000:8000 \
  -e UMAMI_TRANSPORT=streamable-http \
  -e MCP_HOST=0.0.0.0 \
  umami-mcp
```

### Deployment behind an HTTP gateway

When fronting the wrapper with a gateway (LiteLLM, Kong, NGINX, etc.) over a
shared network, set `MCP_BEARER_TOKEN` to a random secret. The wrapper will
then reject any HTTP request that does not present a matching
`Authorization: Bearer <token>` header.

```bash
export MCP_BEARER_TOKEN="$(openssl rand -hex 32)"
export UMAMI_TRANSPORT=streamable-http
export MCP_HOST=0.0.0.0   # bind to all interfaces inside the container
node dist/index.js
```

Notes:
- `MCP_BEARER_TOKEN` is **transport-aware** — it has no effect when
  `UMAMI_TRANSPORT=stdio`. Existing stdio consumers keep working untouched.
- The `Bearer` scheme name is matched case-insensitively (RFC 7235 §2.1); the
  token itself is compared byte-for-byte with `crypto.timingSafeEqual` for
  constant-time defence against timing oracles.
- Both 401 paths (missing header, wrong/short token) emit identical responses
  so a client cannot distinguish them.
- Pair the bearer with TLS at the gateway so the token is not exposed on the
  wire.

## Tools

The server exposes the full Umami v2 API surface (66 tools, 2 resources, 2
prompts) inherited from the upstream project. See `src/tools/` for the
authoritative list.

## Development

```bash
npm install
npm run build      # Compile TypeScript → dist/
npm run dev        # tsx watch
npm run lint       # tsc --noEmit
```

## Origin & Acknowledgments

This repository began as a copy of
[mikusnuz/umami-mcp](https://github.com/mikusnuz/umami-mcp) at tag **v1.2.1**
(MIT License — Copyright © 2026 mikusnuz). All credit for the original
Umami API mapping (66 tools, 2 resources, 2 prompts) belongs to that project.

The TETRA fork is intentionally **disconnected from upstream**: we operate
independently to add gateway-deployment features (HTTP transport, bearer
middleware) on our own cadence, without imposing back-and-forth on a small
single-maintainer project. Future Umami API changes upstream will be picked
up manually as needed.

The original `LICENSE` file is retained verbatim and remains in force for the
material it covers.

## License

MIT (see [`LICENSE`](LICENSE)).
