/**
 * What a run spends is the turns' own seconds, never the queue's (#1476).
 *
 * The bound this task holds against a shared deployment means a case can wait
 * far longer than it runs, and the driver's own `task_duration` brackets the
 * whole task call — the wait included. Read as machine time, that number said
 * the 662-case run of 2026-09-07 cost 3,043,667 seconds of a wall clock that
 * moved 8,795. So the turn times itself from inside the slot, and this is the
 * two-case arithmetic that tells the two readings apart: two one-second turns
 * taken one at a time cost two seconds, not three.
 *
 * NOTHING HERE IS TIMED BY THE MACHINE. The clock is a variable that moves only
 * while a turn is in flight, and no turn starts until both cases have been
 * handed to the task — so the second case is provably in the queue while the
 * first one's second passes, and the assertion is about which bracket was
 * measured rather than about how fast this machine is.
 *
 * test-type: integration (the driver's own case run, fake door, fake clock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Dataset } from "logfire/evals";

import type { ExportedAgentExpected, ExportedAgentInput } from "../src/dataset-roundtrip.ts";
import type { AgentEvalReport } from "../src/gate-run/gate-run-result.ts";
import { runSpendOf } from "../src/gate-run/run-spend.ts";
import { StagingBearer } from "../src/staging-bearer.ts";
import { StagingTurnTask, TURN_SECONDS_ATTRIBUTE } from "../src/staging-turn-task.ts";
import type { TranscriptResult } from "../src/turn-transcript.ts";
import { fakeStagingDoor } from "./fake-staging-door.ts";
import { makeAgentCase } from "./gated-run.ts";

/** How long one turn is in flight, on the clock the task is handed. */
const TURN_MS = 1000;

/** Two cases, one slot: the whole point is that one of them queues. */
const CASES = [makeAgentCase("first"), makeAgentCase("second")];

const STREAM = 'data: {"type":"finish"}\n\n';
const HISTORY = { messages: [], revision: 1, next_offset: null, run: null, steps: [] };

/** Opens once every case has been handed to the task. Holding the first turn
 * until then is what makes the second case's wait a fact rather than a race:
 * the clock cannot move before both cases are in flight. */
function everyCaseInFlight(): { arrive: () => void; opened: Promise<unknown> } {
  const admits: (() => void)[] = [];
  const opened = Promise.all(
    CASES.map(() => new Promise<void>((admit) => admits.push(admit))),
  );
  return { arrive: () => admits.pop()?.(), opened };
}

async function reportOfQueuedTurns(): Promise<AgentEvalReport> {
  let clock = 0;
  const startLine = everyCaseInFlight();
  const staging = fakeStagingDoor({
    stream: STREAM,
    history: HISTORY,
    sessionId: "session-minted",
    settle: async () => {
      await startLine.opened;
      clock += TURN_MS;
    },
  });
  const task = new StagingTurnTask({
    door: staging.door,
    bearer: new StagingBearer(() => Promise.resolve("qa-token"), () => 0),
    turnId: () => "turn-1",
    maxConcurrency: 1,
    now: () => clock,
  });
  return await queuedDataset().evaluate((inputs) => {
    startLine.arrive();
    return task.run(inputs);
  }, { name: "turn_seconds" });
}

function queuedDataset(): Dataset<ExportedAgentInput, TranscriptResult, ExportedAgentExpected> {
  return new Dataset<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>({
    name: "queued-turns",
    cases: CASES,
    evaluators: [],
  });
}

const report = await reportOfQueuedTurns();

/** Mutation: take the start reading before `InFlightTurns.enter` and the case
 * that waited reports 2 — the second it spent in line, charged to the model. */
void test("a queued case is charged its own turn and not its wait", () => {
  assert.deepEqual(
    report.cases.map((entry) => entry.attributes[TURN_SECONDS_ATTRIBUTE]),
    [1, 1],
  );
});

void test("two one-second turns taken one at a time spend two seconds", () => {
  assert.equal(runSpendOf(report).task_seconds, 2);
});
