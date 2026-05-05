/**
 * Bearer-token authentication middleware for HTTP transports.
 *
 * Express middleware. Reject requests lacking a matching
 * `Authorization: Bearer <token>`. Constant-time comparison via
 * `crypto.timingSafeEqual` to defeat timing oracles. The `Bearer` scheme
 * name is matched case-insensitively per RFC 7235 §2.1.
 *
 * The middleware is only mounted when running under HTTP transports
 * (streamable-http / sse) AND `MCP_BEARER_TOKEN` is set; stdio transport
 * never sees it.
 *
 * Both 401 paths (missing header, wrong token, length mismatch) emit the
 * same body and headers so a client cannot distinguish them.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { timingSafeEqual } from "node:crypto";

const BEARER_PREFIX = "bearer ";
const UNAUTHORIZED_BODY = '{"error":"unauthorized"}';

export interface BearerAuthOptions {
  expectedToken: string;
  skipPaths?: readonly string[];
}

export function bearerAuth({
  expectedToken,
  skipPaths = [],
}: BearerAuthOptions): RequestHandler {
  if (!expectedToken) {
    throw new Error("expectedToken must be a non-empty string");
  }
  const expectedBuf = Buffer.from(expectedToken, "utf8");
  const normalizedSkipPaths = skipPaths.map((p) => p.replace(/\/+$/, ""));

  return (req: Request, res: Response, next: NextFunction): void => {
    const path = req.path ?? "";
    for (const trimmed of normalizedSkipPaths) {
      if (path === trimmed || path.startsWith(`${trimmed}/`)) {
        next();
        return;
      }
    }

    const auth = req.header("authorization") ?? "";
    if (auth.slice(0, BEARER_PREFIX.length).toLowerCase() !== BEARER_PREFIX) {
      send401(res);
      return;
    }

    const provided = auth.slice(BEARER_PREFIX.length);
    if (!provided) {
      send401(res);
      return;
    }

    const providedBuf = Buffer.from(provided, "utf8");
    if (providedBuf.length !== expectedBuf.length) {
      // timingSafeEqual requires equal-length inputs.
      send401(res);
      return;
    }

    if (!timingSafeEqual(providedBuf, expectedBuf)) {
      send401(res);
      return;
    }

    next();
  };
}

function send401(res: Response): void {
  res
    .status(401)
    .setHeader("content-type", "application/json")
    .setHeader("www-authenticate", 'Bearer realm="umami-mcp"')
    .send(UNAUTHORIZED_BODY);
}
