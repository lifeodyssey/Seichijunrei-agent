/**
 * EG-05 (#1343): every edge rejection answers in ONE envelope.
 *
 * `src/gateway/responses.ts` has always claimed that "one client parser covers
 * the whole surface", while six sites answered a flat `{ error: "…" }` or plain
 * text beside it — shapes `apps/web`'s classifier (which branches on
 * `error.code`) cannot read. These cases pin the envelope at the builder and at
 * each site that used to have its own shape.
 *
 * test-type: unit
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { stubCtx } from "../src/container/entry-env.ts";
import { gatewayRejection } from "../src/gateway/responses.ts";
import { catalogOutbound } from "../src/gateway/forward.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";

const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
const SECRET = "fixed-test-hmac-key-0000000000000000";

function openEnv(extra: Record<string, unknown> = {}): never {
  return { EDGE_SHOWCASE_MODE: "false", ...extra } as never;
}

async function envelopeOf(response: Response): Promise<{ error?: { code?: string; message?: string } }> {
  return (await response.json()) as { error?: { code?: string; message?: string } };
}

void test("a rejection is a coded error object, never a bare string", async () => {
  const rejection = gatewayRejection("teapot", 418, "Short and stout.");
  assert.equal(rejection.status, 418);
  assert.deepEqual(await rejection.json(), { error: { code: "teapot", message: "Short and stout." } });
});

void test("a rejection with nothing to render omits the message rather than inventing one", async () => {
  assert.deepEqual(await gatewayRejection("teapot", 418).json(), { error: { code: "teapot" } });
});

void test("the public catalog read refuses query parameters in the envelope, not as text", async () => {
  const response = await createWorkerApp({}).request(
    "/catalog/public/anime-overview/1?spoof=1", {}, openEnv(), stubCtx,
  );
  assert.equal(response.status, 400);
  assert.equal((await envelopeOf(response)).error?.code, "unexpected_query");
});

void test("the image proxy refuses a traversal path in the envelope, not as text", async () => {
  const response = await createWorkerApp({}).request("/img/a..b", {}, openEnv(), stubCtx);
  assert.equal(response.status, 400);
  assert.equal((await envelopeOf(response)).error?.code, "image_path_invalid");
});

void test("a tile rejection carries its code inside the envelope and keeps its CORS headers", async () => {
  const env = openEnv({ MAP_TILES: { get: () => Promise.resolve(null) } });
  const response = await createWorkerApp({}).request("/tiles/styles/basemap.json", {}, env, stubCtx);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual(await response.json(), { error: { code: "tile_not_found" } });
});

void test("anonymous entry verification answers the shared 401, not a flat error string", async () => {
  const env = openEnv({
    ANON_ACCESS_ENABLED: "false", ANON_ID_SECRET: SECRET, EDGE_GUARD: fakeGuard(NOW).namespace,
  });
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const) });
  const response = await app.request("/v1/turnstile/verify", { method: "POST" }, env, stubCtx);
  assert.equal(response.status, 401);
  assert.equal((await envelopeOf(response)).error?.code, "unauthorized");
});

void test("a catalog call the container is not allowed to make is refused in the envelope", async () => {
  const request = new Request("http://catalog.internal/catalog/publish", { method: "POST" });
  const response = await catalogOutbound(request, { CATALOG: { fetch: () => Promise.reject(new Error("never")) } } as never);
  assert.equal(response.status, 403);
  assert.equal((await envelopeOf(response)).error?.code, "catalog_request_forbidden");
});
