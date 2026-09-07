/**
 * The task's four rules (W3-2 #1300): what it retries, what it must not, how a
 * multi-turn case reaches one session, and how many turns it opens at once.
 *
 * Every one of them is about the SHARED deployment on the other end, which is
 * why none can be left to a live run to discover.
 *
 * test-type: unit (fake door, fake clock, no network).
 */
import test from "node:test";
import assert from "node:assert/strict";

import type { ExportedAgentInput } from "../src/dataset-roundtrip.ts";
import { StagingBearer } from "../src/staging-bearer.ts";
import { StagingTurnTask, TransportFailure } from "../src/staging-turn-task.ts";
import { fakeStagingDoor, type DoorScript } from "./fake-staging-door.ts";

const SESSION_ID = "session-fixture";

const ANSWERED = [
  'data: {"type":"tool-input-start","toolCallId":"c1","toolName":"resolve_anime"}',
  'data: {"type":"tool-input-available","toolCallId":"c1","toolName":"resolve_anime","input":{"title":"ハルヒ"}}',
  'data: {"type":"tool-output-available","toolCallId":"c1","output":{"bangumi_id":1}}',
  'data: {"type":"data-response","id":"response","data":{"intent":"clarify","success":true,"message":"どれ？","data":{"candidates":[]}}}',
  "data: [DONE]",
].join("\n\n");

const TOOL_FAILED = ANSWERED.replace(
  '{"type":"tool-output-available","toolCallId":"c1","output":{"bangumi_id":1}}',
  '{"type":"tool-output-error","toolCallId":"c1","errorText":"boom"}',
);

const HISTORY = { messages: [], revision: 1, next_offset: null, run: { run_id: "r1", status: "succeeded" } };

function agentInput(overrides: Partial<ExportedAgentInput> = {}): ExportedAgentInput {
  return {
    clarification_id: null,
    context: null,
    locale: "ja",
    query: "ハルヒの聖地",
    seeded_pending: null,
    selected_candidate_ids: null,
    selected_point_ids: null,
    ...overrides,
  };
}

function taskOver(script: Partial<DoorScript>, maxConcurrency?: number) {
  const fake = fakeStagingDoor({ stream: ANSWERED, history: HISTORY, sessionId: SESSION_ID, ...script });
  let issued = 0;
  const task = new StagingTurnTask({
    door: fake.door,
    bearer: new StagingBearer(() => Promise.resolve("token"), () => 0),
    turnId: () => `turn-${String((issued += 1))}`,
    maxConcurrency,
  });
  return { fake, task };
}

const chatCalls = (fake: ReturnType<typeof taskOver>["fake"]) =>
  fake.calls.filter((call) => call.path === "/v1/chat");

void test("a request that never reached staging is sent again, once", async () => {
  const { fake, task } = taskOver({ rejectFirst: 1 });
  const result = await task.run(agentInput());
  assert.equal(result.intent, "clarify");
  assert.equal(chatCalls(fake).length, 2);
});

void test("a second transport failure fails the case rather than looping", async () => {
  const { fake, task } = taskOver({ rejectFirst: 2 });
  await assert.rejects(task.run(agentInput()), TransportFailure);
  assert.equal(chatCalls(fake).length, 2);
});

/**
 * The measurement, not a fault: a tool that ran and threw is exactly what the
 * trajectory evaluators are scoring. A retry here would turn a failing case
 * into a passing one on the second try, silently.
 */
void test("a tool that answered with an error is never retried", async () => {
  const { fake, task } = taskOver({ stream: TOOL_FAILED });
  const result = await task.run(agentInput());
  assert.deepEqual(result.trajectory.map((step) => step.status), ["error"]);
  assert.equal(chatCalls(fake).length, 1);
});

void test("a case's recorded history is replayed on the same session as its query", async () => {
  const context = { message_history: [{ user: "凉宫有哪些作品？" }, { user: "接下来只记录交通偏好。" }] };
  const { fake, task } = taskOver({});
  await task.run(agentInput({ context }));
  const sent = chatCalls(fake);
  assert.equal(sent.length, 3);
  assert.deepEqual(sent.map((call) => call.headers.get("x-session-id")), [null, SESSION_ID, SESSION_ID]);
});

/**
 * The earlier turns are not scaffolding to be discarded (E-3 #1382): #1377 puts
 * their tool returns back in front of the model on the measured turn, so a
 * reply sourced from one of them is sourced. Mutation: drop `priorStreams` and
 * this goes red.
 */
void test("an earlier turn's tool returns come back with the measured turn", async () => {
  const context = { message_history: [{ user: "前のターン" }] };
  const { task } = taskOver({});
  const result = await task.run(agentInput({ context }));
  assert.deepEqual(
    result.priorTrajectory.map((step) => [step.toolName, step.output]),
    [["resolve_anime", { bangumi_id: 1 }]],
  );
});

void test("every submission carries its own dedupe key", async () => {
  const context = { message_history: [{ user: "先の話" }] };
  const { fake, task } = taskOver({});
  await task.run(agentInput({ context }));
  assert.deepEqual(chatCalls(fake).map((call) => call.headers.get("x-turn-id")), ["turn-1", "turn-2"]);
});

void test("the measured turn is the last one, and its transcript is read back", async () => {
  const { fake, task } = taskOver({});
  const result = await task.run(agentInput());
  assert.equal(result.runStatus, "succeeded");
  assert.deepEqual(
    fake.calls.map((call) => call.path),
    ["/v1/chat", `/v1/conversations/${SESSION_ID}/messages`],
  );
});

void test("no more turns are open at once than the bound allows", async () => {
  let admit = (): void => undefined;
  const held = new Promise<void>((resolve) => (admit = resolve));
  const { fake, task } = taskOver({ settle: () => held }, 2);
  const running = Promise.all([1, 2, 3, 4, 5, 6].map(() => task.run(agentInput())));
  admit();
  await running;
  assert.equal(fake.peakInFlight(), 2);
});
