/**
 * W2-1 (#1287) lane contract: no staging lane can leak its bearer token onto a
 * plaintext wire.
 *
 * `api-test/` talks to a real deployed origin, so this suite cannot execute it
 * — what it CAN do is read the lanes verbatim, exactly as
 * `catalog-api-lane.test.ts` reads its own. The invariant is the one an
 * operator trips by exporting `CATALOG_API_ORIGIN=http://localhost:8787` for a
 * local experiment: those requests carry a real Neon Auth access token, so the
 * origin has to be refused before the token is sent, not after.
 *
 * The check that matters most is the LAST one. A guard on one lane is a guard
 * one new lane forgets, so `lane-origin.ts` is the single door and this asserts
 * that it stays single: any lane resolving `process.env.CATALOG_API_ORIGIN` for
 * itself is a second door, and a second door is one nobody guarded.
 *
 * test-type: unit (reads checked-in files; no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

/** One file of the staging lane directory, read verbatim. */
function laneFile(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../api-test/${name}`, import.meta.url)), "utf8");
}

/** Every lane `pnpm run test:catalog-api` actually executes. */
const LANE_SUITES = [
  "catalog-api.test.ts",
  "agent-turn.test.ts",
  "web-search-turn.test.ts",
  "byok-probe.test.ts",
];

const DOOR = laneFile("lane-origin.ts");
const RUNBOOK = readFileSync(fileURLToPath(new URL("../api-test/README.md", import.meta.url)), "utf8");
const TOOL = readFileSync(fileURLToPath(new URL("../src/agent/tools/web-search-tool.ts", import.meta.url)), "utf8");
const SEARCHER = readFileSync(fileURLToPath(new URL("../src/agent/tools/duckduckgo-web-searcher.ts", import.meta.url)), "utf8");
const EGRESS = readFileSync(fileURLToPath(new URL("../src/agent/egress/egress-decision.ts", import.meta.url)), "utf8");

/** The body of the door's own destination check, where every refusal is decided. */
function destinationCheck(): string {
  const start = DOOR.indexOf("function checkedDestination(): LaneDestination {");
  assert.notEqual(start, -1, "the lanes must check their destination in one named place");
  return DOOR.slice(start, DOOR.indexOf("\n}", start));
}

void test("the shared door requires HTTPS of every origin that is not the loopback", () => {
  assert.match(destinationCheck(), /"https:"/);
  assert.match(destinationCheck(), /url\.protocol,/);
});

void test("no lane opens a second door onto the origin or either credential", () => {
  const environment = /process\.env\.(CATALOG_API_ORIGIN|AGENT_TURN_BEARER|CF_ACCESS_CLIENT_)/;
  const own = LANE_SUITES.filter((name) => environment.test(laneFile(name)));
  assert.deepEqual(own, [], "these lanes read the environment instead of lane-origin.ts");
});

void test("every lane that makes a request resolves it through that door", () => {
  const importing = LANE_SUITES.filter((name) => laneFile(name).includes('from "./lane-origin.ts"'));
  assert.deepEqual(importing, LANE_SUITES);
});

/**
 * `laneFetch` is the only request in this directory, and these two cases are
 * what make that structural rather than a convention. A lane calling `fetch`
 * for itself reaches staging with no Access header and comes back a redirect to
 * a login page — the exact failure #1294 exists to stop, wearing the costume of
 * a broken app.
 */
void test("no lane calls fetch for itself", () => {
  const direct = LANE_SUITES.filter((name) => /\bfetch\(/.test(laneFile(name)));
  assert.deepEqual(direct, [], "these lanes make a request without the Access header");
});

void test("every lane makes at least one request, and all of them through the door", () => {
  const requesting = LANE_SUITES.filter((name) => laneFile(name).includes("laneFetch("));
  assert.deepEqual(requesting, LANE_SUITES);
});

void test("the door presents the credential on every request it makes", () => {
  assert.match(DOOR, /headers: laneHeaders\(init\.headers\)/);
  assert.match(DOOR, /for \(const \[name, value\] of Object\.entries\(access\)\) headers\.set\(name, value\)/);
});

void test("the door reads the Access service token in one shared place, not for itself", () => {
  // D3 #1369. The two variable names and the two header names live in
  // `@animichi/contract/access-service-token` because four callers present the
  // same credential — the CI smoke script, this door, the Playwright suite and
  // (through this door) the eval runner. A door that spelled the headers itself
  // would be the fourth spelling nobody diffs.
  assert.match(DOOR, /from "@animichi\/contract\/access-service-token"/);
  assert.ok(
    !/CF_ACCESS_CLIENT_(ID|SECRET)|CF-Access-Client-/.test(DOOR),
    "the door must not spell the variable or header names a second time",
  );
});

void test("the loopback is answered before the Access token is even read", () => {
  const check = destinationCheck();
  assert.match(check, /if \(isLoopback\(url\)\) return \{ origin, access: \{\} \};/);
  assert.ok(
    check.indexOf("isLoopback(url)") < check.indexOf("accessServiceTokenHeaders("),
    "a local dev origin must never be handed staging's Access service token",
  );
});

void test("no request the door makes may follow a redirect off the origin", () => {
  const call = DOOR.slice(DOOR.indexOf("export function laneFetch("));
  assert.match(call, /redirect: "error",/);
  assert.ok(
    call.indexOf("...init") < call.indexOf('redirect: "error"'),
    "the redirect rule must be set after the spread, where no caller can undo it",
  );
});

void test("the door still refuses to guess an origin or a credential", () => {
  assert.match(DOOR, /assert\.ok\(origin,/);
  assert.match(DOOR, /assert\.ok\(bearer,/);
});

/**
 * `Search failed for …` is one sentence covering four different causes, and the
 * runbook is the only place an operator learns to tell them apart. These pin it
 * to the code: a detail the runbook explains but nothing produces would send
 * somebody hunting a failure mode that does not exist, and a detail the code
 * produces but the runbook omits is the one they will misdiagnose.
 */
void test("the runbook does not read one failure sentence as one diagnosis", () => {
  assert.match(RUNBOOK, /that is ALL it means on its own/);
  assert.match(RUNBOOK, /web_search_failed/, "the server-side half has to be findable too");
});

void test("every failure detail the runbook explains is one the code can produce", () => {
  const source = `${TOOL}${SEARCHER}${EGRESS}`;
  const documented = ["egress denied: ", "search backend answered ", "the search timed out"];
  const produced = documented.filter((detail) => RUNBOOK.includes(detail) && source.includes(detail));
  assert.deepEqual(produced, documented);
});

void test("the runbook states both rules an operator can otherwise trip", () => {
  assert.match(RUNBOOK, /requires HTTPS of every\n?non-loopback origin/);
  assert.match(RUNBOOK, /NO Access credential because it is behind no door/);
  assert.match(RUNBOOK, /`redirect: "error"`/);
});
