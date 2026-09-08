/**
 * W2 (#1294) and D3 (#1369): the staging credentials and the redirect rule, as
 * the door actually applies them.
 *
 * `web-search-lane.test.ts` reads the lanes verbatim — that is what catches a
 * NEW lane forgetting the door — but reading source can only ever prove the
 * code says the right thing. This one runs it.
 *
 * The environment is set per case because the door reads it per call, which is
 * what lets one process drive both the staging branch and the loopback branch.
 * The token is a zero-entropy sentinel: the real one lives in the operator's
 * environment and belongs in no file in this repo.
 *
 * test-type: unit (no network — the transport is a double; no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { laneFetch, laneHeaders } from "../api-test/lane-origin.ts";

const SENTINEL = "not-a-real-gate-token";
const ACCESS_ID = "not-a-real-client-id";
const ACCESS_SECRET = "not-a-real-client-secret";
const STAGING = "https://staging.invalid";
const LOOPBACK = "http://localhost:8787";

/** Declare a complete Cloudflare Access service token, or none at all. */
function useAccessToken(declared: boolean): void {
  if (!declared) {
    delete process.env.CF_ACCESS_CLIENT_ID;
    delete process.env.CF_ACCESS_CLIENT_SECRET;
    return;
  }
  process.env.CF_ACCESS_CLIENT_ID = ACCESS_ID;
  process.env.CF_ACCESS_CLIENT_SECRET = ACCESS_SECRET;
}

/** Point the door at a deployed origin behind the gate and Access. */
function useStagingOrigin(): void {
  process.env.CATALOG_API_ORIGIN = STAGING;
  process.env.STAGING_GATE_TOKEN = SENTINEL;
  useAccessToken(true);
}

/** Point the door at a local `wrangler dev`, which is behind neither door. */
function useLoopbackOrigin(): void {
  process.env.CATALOG_API_ORIGIN = LOOPBACK;
  process.env.STAGING_GATE_TOKEN = SENTINEL;
  useAccessToken(true);
}

void test("every request the door builds for staging carries the gate header", () => {
  useStagingOrigin();
  assert.equal(laneHeaders().get("x-staging-key"), SENTINEL);
});

void test("the gate rides alongside what the call itself needs, not instead of it", () => {
  useStagingOrigin();
  const headers = laneHeaders({ "Content-Type": "application/json", "x-locale": "ja" });
  assert.deepEqual(
    ["content-type", "x-locale", "x-staging-key"].map((name) => headers.get(name)),
    ["application/json", "ja", SENTINEL],
  );
});

void test("a caller cannot substitute its own gate credential", () => {
  useStagingOrigin();
  assert.equal(laneHeaders({ "x-staging-key": "something-else" }).get("x-staging-key"), SENTINEL);
});

void test("a local dev origin is never handed the staging credential", () => {
  useLoopbackOrigin();
  assert.equal(laneHeaders().get("x-staging-key"), null);
  assert.equal(laneHeaders().get("cf-access-client-id"), null);
  assert.equal(laneHeaders().get("cf-access-client-secret"), null);
  assert.equal(laneHeaders({ "x-locale": "ja" }).get("x-locale"), "ja");
});

void test("every request the door builds for staging carries the Access service token", () => {
  // D3 #1369. Both halves or neither: Access answers a one-header request with a
  // 302 to its login page, which arrives as an HTML body where the lane expected
  // JSON and reads as a broken deploy.
  useStagingOrigin();
  assert.deepEqual(
    ["cf-access-client-id", "cf-access-client-secret"].map((name) => laneHeaders().get(name)),
    [ACCESS_ID, ACCESS_SECRET],
  );
});

void test("a caller cannot substitute its own Access credential", () => {
  useStagingOrigin();
  const headers = laneHeaders({ "CF-Access-Client-Id": "someone-elses" });
  assert.equal(headers.get("cf-access-client-id"), ACCESS_ID);
});

void test("no Access token declared is the ordinary case, not a refusal", () => {
  // The transitional state PR 1 ships in and the permanent state of any origin
  // that is not behind an Access application: the door still works, it just has
  // nothing to present.
  useStagingOrigin();
  useAccessToken(false);
  assert.equal(laneHeaders().get("cf-access-client-id"), null);
  assert.equal(laneHeaders().get("x-staging-key"), SENTINEL);
});

void test("half an Access token is refused before the request is built", () => {
  useStagingOrigin();
  useAccessToken(false);
  process.env.CF_ACCESS_CLIENT_ID = ACCESS_ID;
  assert.throws(() => laneHeaders(), /CF_ACCESS_CLIENT_SECRET/);
  useAccessToken(false);
  process.env.CF_ACCESS_CLIENT_SECRET = ACCESS_SECRET;
  assert.throws(() => laneHeaders(), /CF_ACCESS_CLIENT_ID/);
});

/** One scripted answer: a redirect to `location`, or a terminal status. */
interface TransportAnswer {
  status: number;
  location?: string;
}

/**
 * A `fetch` double that models the runtime's OWN redirect contract, because
 * that contract is the thing under test: with `redirect: "error"` a 30x
 * rejects, and with anything else it is followed — headers and all, to
 * whatever the `Location` named. A double that simply handed back the redirect
 * response would let the rule be deleted without a single test noticing.
 */
interface TransportCall {
  url: string;
  redirect: string | undefined;
}

function scriptedTransport(answers: readonly TransportAnswer[]) {
  const calls: TransportCall[] = [];
  const remaining = [...answers];
  const transport = (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, redirect: init?.redirect });
    const answer = remaining.shift() ?? { status: 200 };
    if (answer.location === undefined) return Promise.resolve(new Response("ok", { status: answer.status }));
    if (init?.redirect === "error") return Promise.reject(new TypeError("fetch failed: unexpected redirect"));
    return transport(answer.location, init);
  };
  return { calls, transport };
}

void test("a redirect is refused, never followed with the credentials attached", async (t) => {
  useStagingOrigin();
  const { calls, transport } = scriptedTransport([{ status: 302, location: "https://evil.invalid/steal" }]);
  const runtimeFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = runtimeFetch;
  });
  // The door only ever calls `fetch(url, init)` with a string URL, so the
  // double declares that narrower shape and is adapted here rather than
  // pretending to implement every overload of the platform's own signature.
  globalThis.fetch = ((url: string, init?: RequestInit) => transport(url, init)) as unknown as typeof fetch;

  await assert.rejects(laneFetch("/v1/chat", { method: "POST" }));
  assert.deepEqual(calls.map((call) => call.url), [`${STAGING}/v1/chat`]);
  assert.deepEqual(calls.map((call) => call.redirect), ["error"]);
});
