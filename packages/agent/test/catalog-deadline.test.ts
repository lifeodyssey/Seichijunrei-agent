import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createCatalogClient } from "@animichi/agent/tools";
import { catalogClock, pendingCatalog } from "./catalog-clock.ts";

void test("a catalog transport attempt aborts at 25 seconds", async (context) => {
  catalogClock(context);
  const transport = pendingCatalog(1);
  const caller = new AbortController();
  const catalog = createCatalogClient(transport.fetch);
  const completed = catalog.resolve({ query: "Title" }, { signal: caller.signal, context: { retry: 0 } }).then(() => false, () => true);
  context.after(() => { caller.abort(); });
  const { request } = await transport.received(0);
  context.mock.timers.tick(24_999);
  assert.equal(request.signal.aborted, false);
  context.mock.timers.tick(1);
  assert.equal(request.signal.aborted, true);
  assert.equal(await completed, true);
});

void test("native transport timeouts retry through the official plugin", async (context) => {
  catalogClock(context);
  const requests: Request[] = [];
  const catalog = createCatalogClient((request) => { requests.push(request); return Promise.reject(new DOMException("Native transport expired", "TimeoutError")); });
  const completed = catalog.resolve({ query: "Title" }).then(() => false, () => true);
  await setImmediate();
  assert.equal(requests.length, 1);
  context.mock.timers.tick(2_000);
  await setImmediate();
  assert.equal(requests.length, 2);
  context.mock.timers.tick(2_000);
  await setImmediate();
  assert.equal(requests.length, 3);
  assert.equal(await completed, true);
});

void test("the catalog's 80-second deadline bounds all retries and their delays", async (context) => {
  catalogClock(context);
  const transport = pendingCatalog(3);
  const caller = new AbortController();
  context.after(() => { caller.abort(); });
  const catalog = createCatalogClient(transport.fetch);
  const completed = catalog.resolve({ query: "Title" }, { signal: caller.signal, context: { retryDelay: 10_000 } }).then(() => false, () => true);
  const first = await transport.received(0);
  context.mock.timers.tick(25_000);
  assert.equal(first.request.signal.aborted, true);
  await setImmediate();
  context.mock.timers.tick(10_000);
  const second = await transport.received(1);
  context.mock.timers.tick(25_000);
  assert.equal(second.request.signal.aborted, true);
  await setImmediate();
  context.mock.timers.tick(10_000);
  const third = await transport.received(2);
  context.mock.timers.tick(9_999);
  assert.equal(third.request.signal.aborted, false);
  context.mock.timers.tick(1);
  assert.equal(third.request.signal.aborted, true);
  assert.equal(await completed, true);
});

void test("the official retry plugin stops after three catalog attempts", async (context) => {
  catalogClock(context);
  const caller = new AbortController();
  context.after(() => { caller.abort(); context.mock.timers.runAll(); });
  const requests: Request[] = [];
  const catalog = createCatalogClient((request) => { requests.push(request); return Promise.resolve(new Response("Unavailable", { status: 503 })); });
  let failed = false;
  const completed = catalog.resolve({ query: "Title" }, { signal: caller.signal }).then(() => undefined, () => { failed = true; });
  await setImmediate();
  assert.equal(requests.length, 1);
  context.mock.timers.tick(2_000);
  await setImmediate();
  assert.equal(requests.length, 2);
  context.mock.timers.tick(2_000);
  await setImmediate();
  assert.equal(requests.length, 3);
  assert.equal(failed, true);
  await completed;
});
