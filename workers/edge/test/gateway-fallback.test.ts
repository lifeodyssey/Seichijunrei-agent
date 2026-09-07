import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { createWorkerApp } from "../src/app.ts";

// Issue #537: the edge Worker no longer bundles the legacy Next.js app, so
// there is no HTML renderer left to fall back to. An unmatched path is now a
// genuine 404 in the same JSON error envelope every other edge rejection uses
// (`unauthorized`, `rate_limited`) — a 200 "this is an API gateway" body would
// be a soft-404 that poisons crawlers and gives clients nothing to branch on.

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

function entrySource(): string {
  return readFileSync(fileURLToPath(new URL("../src/entry.ts", import.meta.url)), "utf8");
}

void test("an unmatched path is 404, not a rendered page", async () => {
  const app = createWorkerApp({});
  const res = await app.request("/unmatched/path", {}, {}, stubCtx);
  assert.equal(res.status, 404);
});

void test("the unmatched-path body is the shared JSON error envelope", async () => {
  const app = createWorkerApp({});
  const res = await app.request("/some/legacy/page", {}, {}, stubCtx);
  assert.equal(res.headers.get("Content-Type"), "application/json");
  assert.deepEqual(await res.json(), {
    error: { code: "not_found", message: "No route matches this request." },
  });
});

void test("a non-allowlisted /catalog/public path answers the same 404 envelope", async () => {
  const app = createWorkerApp({});
  let wasCatalogHit = false;
  const env = { CATALOG: { fetch: () => { wasCatalogHit = true; return Promise.resolve(new Response("cat")); } } } as never;
  const res = await app.request("/catalog/public/secret", {}, env, stubCtx);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), {
    error: { code: "not_found", message: "No route matches this request." },
  });
  assert.equal(wasCatalogHit, false);
});

void test("the deleted /v1/session/migrate path is a hard 404, never forwarded (SESSION-2 #960)", async () => {
  const app = createWorkerApp({});
  let wasForwarded = false;
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({
        fetch: () => { wasForwarded = true; return Promise.resolve(new Response("forwarded")); },
      }),
    },
  } as never;
  const res = await app.request("/v1/session/migrate", { method: "POST" }, env, stubCtx);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), {
    error: { code: "not_found", message: "No route matches this request." },
  });
  assert.equal(wasForwarded, false);
});

void test("entry.ts imports nothing from the retired OpenNext bundle", () => {
  assert.doesNotMatch(entrySource(), /\.open-next/);
});

void test("entry.ts no longer re-exports the OpenNext durable objects", () => {
  assert.doesNotMatch(entrySource(), /DOQueueHandler|DOShardedTagCache/);
});

void test("entry.ts still re-exports the container's own durable object", () => {
  assert.match(entrySource(), /export\s+class\s+RuntimeContainer/);
});
