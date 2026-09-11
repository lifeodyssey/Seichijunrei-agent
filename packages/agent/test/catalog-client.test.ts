import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogClient } from "@animichi/agent/tools";

void test("catalog calls follow the declared OpenAPI route and validate both boundaries", async () => {
  const requests: Request[] = [];
  const catalog = createCatalogClient((request) => {
    requests.push(request);
    return Promise.resolve(Response.json({ outcome: "not_found", reason: "anime_not_found" }));
  });
  assert.deepEqual(await catalog.resolve({ query: "  Your Name  " }), { outcome: "not_found", reason: "anime_not_found" });
  assert.equal(requests[0]?.url, "https://catalog.internal/catalog/resolve");
  assert.deepEqual(await requests[0].json(), { query: "  Your Name  " });
  await assert.rejects(catalog.resolve({ query: "   " }));
  assert.equal(requests.length, 1);
});

void test("catalog refuses malformed successful responses without retrying them", async () => {
  let calls = 0;
  const catalog = createCatalogClient(() => {
    calls += 1;
    return Promise.resolve(Response.json({ outcome: "resolved", match: {} }));
  });
  await assert.rejects(catalog.resolve({ query: "Your Name" }));
  assert.equal(calls, 1);
});

void test("catalog preserves an aborted call before making an external request", async () => {
  let calls = 0;
  const catalog = createCatalogClient(() => {
    calls += 1;
    return Promise.resolve(Response.json({ outcome: "not_found", reason: "anime_not_found" }));
  });
  await assert.rejects(catalog.resolve({ query: "Your Name" }, { signal: AbortSignal.abort() }));
  assert.equal(calls, 0);
});

void test("catalog redirects are refused manually before a second host can be contacted", async () => {
  const requests: Request[] = [];
  const catalog = createCatalogClient((request) => {
    requests.push(request);
    return Promise.resolve(new Response("private redirect body", { status: 302, headers: { Location: "https://outside.invalid" } }));
  });
  await assert.rejects(catalog.resolve({ query: "Your Name" }), /redirect/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.redirect, "manual");
});
