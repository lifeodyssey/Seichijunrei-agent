/**
 * This package opens no second door onto staging (W3-2 #1300).
 *
 * `workers/edge/test/web-search-lane.test.ts` holds the api-test lanes to
 * `lane-origin.ts`; this is the same invariant for the same door's second
 * consumer, and it lives here because a guard on somebody else's files is a
 * guard nobody updates. What it protects is not tidiness: a request that
 * resolved the origin for itself reaches staging with no `x-staging-key` and
 * comes back a Cloudflare 403 block page, which reads as a broken app; and a
 * request that skipped `laneFetch` could follow a redirect carrying both the
 * gate header and a Neon Auth bearer to whatever `Location` named (#1291,
 * #1294).
 *
 * `src/` is held to something stricter still — it makes no request at all. The
 * task takes the door as a port, which is what lets the suites above drive it
 * with a fake, and a `fetch(` appearing there would be a live network call
 * inside a unit test as much as a second door.
 *
 * test-type: unit (reads checked-in files; no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = new URL("../", import.meta.url);

/** The environment the door owns; nothing here may read one for itself.
 *
 * The two Cloudflare Access names joined the list with D3 (#1369) and belong to
 * the door for the same reason the gate token does: a script that read them
 * itself would decide alone whether to send the pair, and half a service token
 * is answered by an Access login page that reads as a broken app. */
const DOOR_ENVIRONMENT =
  /process\.env\.(CATALOG_API_ORIGIN|AGENT_TURN_BEARER|STAGING_GATE_TOKEN|CF_ACCESS_CLIENT_ID|CF_ACCESS_CLIENT_SECRET)/;

/** The one import that reaches staging. */
const DOOR_IMPORT = 'from "edge-worker/api-test/lane-origin.ts"';

/** Every request this package makes lives in one of these three. */
const STAGING_SCRIPTS = ["eval-gate.ts", "eval-staging.ts", "record-captures.ts"];

function sources(directory: string): readonly string[] {
  return readdirSync(fileURLToPath(new URL(directory, PACKAGE_DIR)))
    .filter((name) => name.endsWith(".ts"))
    .sort();
}

function read(directory: string, name: string): string {
  return readFileSync(fileURLToPath(new URL(`${directory}${name}`, PACKAGE_DIR)), "utf8");
}

/** The files in one directory that read the door's environment for themselves. */
function ownDoors(directory: string): readonly string[] {
  return sources(directory).filter((name) => DOOR_ENVIRONMENT.test(read(directory, name)));
}

void test("nothing under src/ resolves the origin or either credential itself", () => {
  assert.deepEqual(ownDoors("src/"), [], "these files read the door's environment instead of going through it");
});

void test("no staging script resolves the origin or either credential itself", () => {
  assert.deepEqual(ownDoors("scripts/"), [], "these files read the door's environment instead of going through it");
});

void test("every staging script reaches the origin through that one door", () => {
  const importing = STAGING_SCRIPTS.filter((name) => read("scripts/", name).includes(DOOR_IMPORT));
  assert.deepEqual(importing, STAGING_SCRIPTS);
});

void test("no staging script calls fetch on the staging origin for itself", () => {
  const direct = STAGING_SCRIPTS.filter((name) => /\bfetch\(/.test(read("scripts/", name)));
  assert.deepEqual(direct, [], "a request outside laneFetch carries no gate header");
});

/**
 * `src/` is a port away from the network on purpose. The exception the rule has
 * to survive is `neon-auth-bearer.ts`, which talks to a DIFFERENT origin — Neon
 * Auth is behind no WAF rule and takes no gate credential — and it still makes
 * no request itself: it is handed a sender.
 */
void test("nothing under src/ makes a request; the door and the sender are both ports", () => {
  const requesting = sources("src/").filter((name) => /\bfetch\(/.test(read("src/", name)));
  assert.deepEqual(requesting, []);
});

void test("no runner imports the door's bearer, because each mints its own", () => {
  const borrowing = STAGING_SCRIPTS.filter((name) => read("scripts/", name).includes("laneBearer"));
  assert.deepEqual(borrowing, [], "AGENT_TURN_BEARER is a 15-minute token read once; see StagingBearer");
});

void test("every runner mints that bearer the one way", () => {
  const minting = STAGING_SCRIPTS.filter((name) => read("scripts/", name).includes("new StagingBearer("));
  assert.deepEqual(minting, STAGING_SCRIPTS);
});
