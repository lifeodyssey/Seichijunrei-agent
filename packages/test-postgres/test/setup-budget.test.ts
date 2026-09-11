/**
 * The two arms' budgets, and the proof that each still spends its own.
 *
 * #1326 merged two data-plane fixtures onto one recipe. The numbers were NOT
 * merged with them — the catalog spike keeps 30 x 1 s because it boots one
 * container for the whole suite, the edge agent-db lane keeps 60 x 1 s because
 * it boots one per file. Pinning the values here is only half of it: the other
 * half is that the deadline is derived, never re-written — #1318's arm file
 * used to do the deriving, and since the native rewrite (#1582) retired that
 * arm, `startTestPostgres` derives from whatever budget the caller hands it.
 *
 * The fixture set is enumerated from the lane directories, never pinned to a
 * count: a number here is a tripwire that fires in this package whenever
 * another package adds a lane (#1386, #1387), and it proves nothing the
 * per-file assertions below do not already prove.
 *
 * test-type: unit (reads checked-in files; no network, no clock).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { AGENT_DB_SETUP_BUDGET, hookTimeoutMs, SPIKE_SETUP_BUDGET } from "../src/setup-budget.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");

const EDGE_DIR = "workers/edge";

/** Every edge lane file that boots the shared postgres recipe, discovered from
 * the `*-test` lane directories rather than listed by hand. */
function edgePostgresFixtures(): string[] {
  return readdirSync(new URL(`${EDGE_DIR}/`, ROOT), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-test"))
    .flatMap((lane) =>
      readdirSync(new URL(`${EDGE_DIR}/${lane.name}/`, ROOT))
        .filter((file) => file.endsWith(".ts"))
        .map((file) => `${EDGE_DIR}/${lane.name}/${file}`),
    )
    .filter((path) => read(path).includes("startTestPostgres"));
}

void test("the catalog spike keeps the budget #1324 measured it on", () => {
  assert.deepEqual(SPIKE_SETUP_BUDGET, {
    deadlineMs: 240_000,
    firstSession: { attemptCeiling: 30, pauseMs: 1_000 },
    chainMarginMs: 60_000,
  });
});

void test("the edge agent-db lane keeps the budget #1318 measured it on", () => {
  assert.deepEqual(AGENT_DB_SETUP_BUDGET, {
    deadlineMs: 240_000,
    firstSession: { attemptCeiling: 60, pauseMs: 1_000 },
    chainMarginMs: 60_000,
  });
});

/** #1318's two published numbers, unchanged by the move into this package. */
void test("the agent-db arm still publishes a 240s deadline inside a 300s hook", () => {
  assert.equal(AGENT_DB_SETUP_BUDGET.deadlineMs, 240_000);
  assert.equal(hookTimeoutMs(AGENT_DB_SETUP_BUDGET), 300_000);
});

void test("startTestPostgres derives the deadline from the budget it is given", () => {
  const source = read("packages/test-postgres/src/test-postgres.ts");
  assert.match(source, /new SetupDeadline\(request\.budget\)/);
  assert.match(source, /withStartupTimeout\(deadline\.remainingMs\(\)\)/);
  assert.doesNotMatch(source, /= 240_000|= 300_000/);
});

void test("every edge lane fixture hands the shared budget to startTestPostgres", () => {
  const fixtures = edgePostgresFixtures();
  assert.ok(fixtures.length > 0, `no startTestPostgres fixture found under ${EDGE_DIR}`);
  for (const fixture of fixtures) {
    assert.match(read(fixture), /budget: AGENT_DB_SETUP_BUDGET/, fixture);
  }
});

/** The budget owns the deadline; a fixture that writes its own number there is
 * back to the sum #1318 removed. */
void test("no edge lane fixture writes its own setup deadline", () => {
  for (const fixture of edgePostgresFixtures()) {
    assert.doesNotMatch(read(fixture), /timeout: 300_000|deadlineMs: [0-9_]+/, fixture);
  }
});
