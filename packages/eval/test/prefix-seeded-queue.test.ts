/**
 * The seeded mark stays on the case that waited for a slot (#1484).
 *
 * `prefix_seeded` used to be written with `setEvalAttribute`, which looks the
 * case up at WRITE time, from `#seededSession` — which `#inFlight.enter`
 * reaches only after the queue wait. `logfire/evals` loads `node:async_hooks`
 * lazily and every case that starts before that import resolves shares ONE
 * module-level variable as its context, so a write made after the wait lands on
 * whichever case entered that fallback last, or on nobody once the storage
 * exists. Measured on this very set-up: with the old write, the seeded case
 * below comes back unmarked. That is why the 2026-09-07 staging run reported the
 * attribute on no case at all (#1303).
 *
 * WHY THREE CASES. The first case of a process is the one that awaits the
 * import, so it alone gets real storage and its late write is safe; a second
 * case runs on the fallback but takes the free slot without waiting, and writes
 * before the import resolves. Only from the third case on is there a case that
 * is BOTH on the fallback and behind the queue — which is what a 662-case run
 * is made of, and what the seeded case here is.
 *
 * NOTHING HERE IS TIMED. Every turn is held at the door until all three cases
 * have been handed to the task, so with one slot the seeded case is provably in
 * line — its turn leaves after another case's — rather than merely likely to be.
 *
 * test-type: integration (the driver's own case run, over a fake door).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Dataset } from "logfire/evals";

import type { ExportedAgentExpected, ExportedAgentInput } from "../src/dataset-roundtrip.ts";
import type { AgentEvalReport } from "../src/gate-run/gate-run-result.ts";
import { SeededSessions } from "../src/seeded-sessions.ts";
import { StagingBearer } from "../src/staging-bearer.ts";
import { PREFIX_SEEDED_ATTRIBUTE, StagingTurnTask } from "../src/staging-turn-task.ts";
import type { TranscriptResult } from "../src/turn-transcript.ts";
import { fakeStagingDoor, type DoorCall } from "./fake-staging-door.ts";
import { makeAgentCase } from "./gated-run.ts";

/** The session this run's one prefix was seeded into. */
const SEEDED_SESSION = "session-seeded";

/** The prefix goes to the last case handed over: the one that runs on the
 * driver's fallback context AND waits for the slot — see WHY THREE CASES. */
const SEEDED_CASE = "seeded-case";
const SEEDED = makeAgentCase(SEEDED_CASE);
const CASES = [makeAgentCase("plain-case"), makeAgentCase("other-plain-case"), SEEDED];

const STREAM = 'data: {"type":"finish"}\n\n';
const HISTORY = { messages: [], revision: 1, next_offset: null, run: null, steps: [] };

/** Opens once every case has been handed to the task. Holding the turns until
 * then is what makes the queue a fact rather than a race: no turn can finish,
 * and so no slot can come free, before all three cases are in flight. */
function everyCaseInFlight(): { arrive: () => void; opened: Promise<unknown> } {
  const admits: (() => void)[] = [];
  const opened = Promise.all(
    CASES.map(() => new Promise<void>((admit) => admits.push(admit))),
  );
  return { arrive: () => admits.pop()?.(), opened };
}

/** The register a `CaseLifecycle` would have filled, filled directly: what is
 * under test is what the task does with a claim, not how the claim was made. */
function oneSeededCase(): SeededSessions {
  const sessions = new SeededSessions();
  sessions.claim(SEEDED.inputs, SEEDED_SESSION);
  return sessions;
}

/** One run of the three cases through the driver, one turn at a time. */
async function queuedSeedingRun(): Promise<{ report: AgentEvalReport; calls: DoorCall[] }> {
  const startLine = everyCaseInFlight();
  const staging = fakeStagingDoor({
    stream: STREAM,
    history: HISTORY,
    sessionId: "session-minted",
    settle: async () => {
      await startLine.opened;
    },
  });
  const task = new StagingTurnTask({
    door: staging.door,
    bearer: new StagingBearer(() => Promise.resolve("qa-token"), () => 0),
    turnId: () => "turn-1",
    maxConcurrency: 1,
    sessions: oneSeededCase(),
  });
  const report = await seedingDataset().evaluate((inputs) => {
    startLine.arrive();
    return task.run(inputs);
  }, { name: "prefix_seeded" });
  return { report, calls: staging.calls };
}

function seedingDataset(): Dataset<ExportedAgentInput, TranscriptResult, ExportedAgentExpected> {
  return new Dataset<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>({
    name: "queued-seeding",
    cases: CASES,
    evaluators: [],
  });
}

/** The cases the report says started from a frozen prefix, in report order. */
function markedCaseNames(report: AgentEvalReport): (string | undefined)[] {
  return report.cases
    .filter((entry) => entry.attributes[PREFIX_SEEDED_ATTRIBUTE] === true)
    .map((entry) => entry.name);
}

/** The session each turn was submitted to, in the order the turns went out. */
function turnSessions(calls: readonly DoorCall[]): (string | null)[] {
  return calls.filter((call) => call.path === "/v1/chat")
    .map((call) => call.headers.get("x-session-id"));
}

const run = await queuedSeedingRun();

/** Mutation: write the mark with `setEvalAttribute` from `#seededSession`, i.e.
 * from behind the queue, and no case in the report carries it. */
void test("the case that queued is the one the report marks as seeded", () => {
  assert.deepEqual(markedCaseNames(run.report), [SEEDED_CASE]);
});

void test("the seeded case's turn went out from behind another case's", () => {
  const [first, ...rest] = turnSessions(run.calls);

  assert.equal(first, null);
  assert.ok(rest.includes(SEEDED_SESSION), "the seeded turn left after another case's");
});
