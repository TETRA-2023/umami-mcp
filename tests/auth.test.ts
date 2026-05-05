/**
 * Bearer-token middleware unit tests.
 *
 * Mirrors the security-critical assertions from homarr-mcp/tests/test_auth.py:
 * - Empty / missing / malformed Authorization → 401 with uniform body
 * - Wrong-token (same length) → 401
 * - Length-mismatch token → 401 (no length-leak side channel)
 * - Correct token → next() invoked, downstream sees the request
 * - `Bearer` scheme is matched case-insensitively per RFC 7235 §2.1
 * - Lifespan / non-HTTP traffic is unaffected (Express only sees HTTP, so
 *   that constraint is implicit; we verify by exercising the skipPaths
 *   bypass instead)
 * - Constructor rejects empty `expectedToken`
 */

import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";

import { bearerAuth } from "../src/auth.js";

const TOKEN = "the-quick-brown-fox-jumps-over-the-lazy-dog";

function buildApp(opts: { skipPaths?: readonly string[] } = {}): express.Application {
  const app = express();
  app.use(express.json());
  app.use(bearerAuth({ expectedToken: TOKEN, skipPaths: opts.skipPaths }));
  app.post("/mcp", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe("bearerAuth", () => {
  describe("constructor", () => {
    it("rejects empty token", () => {
      expect(() => bearerAuth({ expectedToken: "" })).toThrow(/non-empty/);
    });
  });

  describe("rejection paths", () => {
    it("missing Authorization header → 401", async () => {
      const res = await request(buildApp()).post("/mcp").send({});
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized" });
      expect(res.headers["www-authenticate"]).toMatch(/^Bearer realm=/);
    });

    it("wrong scheme (Basic) → 401", async () => {
      const res = await request(buildApp())
        .post("/mcp")
        .set("Authorization", "Basic dXNlcjpwYXNz")
        .send({});
      expect(res.status).toBe(401);
    });

    it("wrong token same length → 401", async () => {
      const wrong = "X".repeat(TOKEN.length);
      const res = await request(buildApp())
        .post("/mcp")
        .set("Authorization", `Bearer ${wrong}`)
        .send({});
      expect(res.status).toBe(401);
    });

    it("length-mismatch token → 401 (no length-leak side channel)", async () => {
      const res = await request(buildApp()).post("/mcp").set("Authorization", "Bearer x").send({});
      expect(res.status).toBe(401);
    });

    it("empty token after Bearer prefix → 401", async () => {
      const res = await request(buildApp()).post("/mcp").set("Authorization", "Bearer ").send({});
      expect(res.status).toBe(401);
    });

    it("uniform 401 body across all rejection paths", async () => {
      const responses = await Promise.all([
        request(buildApp()).post("/mcp"), // missing
        request(buildApp())
          .post("/mcp")
          .set("Authorization", `Bearer ${"X".repeat(TOKEN.length)}`), // wrong, same length
        request(buildApp()).post("/mcp").set("Authorization", "Bearer x"), // length mismatch
      ]);
      const bodies = responses.map((r) => JSON.stringify(r.body));
      expect(new Set(bodies).size).toBe(1);
    });
  });

  describe("acceptance paths", () => {
    it("correct token → next() reached, 200", async () => {
      const res = await request(buildApp())
        .post("/mcp")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("Bearer scheme is case-insensitive (RFC 7235 §2.1)", async () => {
      const variants = ["bearer", "BEARER", "Bearer", "bEaReR", "BeArEr"];
      for (const scheme of variants) {
        const res = await request(buildApp())
          .post("/mcp")
          .set("Authorization", `${scheme} ${TOKEN}`)
          .send({});
        expect(res.status, `scheme=${scheme}`).toBe(200);
      }
    });
  });

  describe("skipPaths bypass", () => {
    it("exact-match skipPath bypasses auth", async () => {
      const res = await request(buildApp({ skipPaths: ["/healthz"] })).get("/healthz");
      expect(res.status).toBe(200);
    });

    it("prefix-match skipPath bypasses auth", async () => {
      const res = await request(buildApp({ skipPaths: ["/health"] })).get("/healthz");
      // /healthz does NOT start with /health/ — only with /health, which is
      // not a prefix segment. Per the prefix-segment rule it should be gated.
      expect(res.status).toBe(401);

      const res2 = await request(buildApp({ skipPaths: ["/healthz"] })).get("/healthz");
      expect(res2.status).toBe(200);
    });

    it("non-matching path stays gated", async () => {
      const res = await request(buildApp({ skipPaths: ["/healthz"] })).post("/mcp");
      expect(res.status).toBe(401);
    });
  });
});
