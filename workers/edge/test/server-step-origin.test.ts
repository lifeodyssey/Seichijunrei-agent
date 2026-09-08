/**
 * #1462: the SD-9 frames say who asked for a step.
 *
 * A deterministic bypass opens its step with `input: {}` because no model
 * produced arguments for it, while the settled `run_steps` row carries the
 * request the visitor made. Read back off the frames alone, that is
 * indistinguishable from a model calling a tool with no arguments — which made
 * `argument_correctness` score every successful selection turn 0.0 for a reason
 * that says nothing about the agent. The marker is what tells the two apart, and
 * it is only useful if the model's own calls do NOT carry it: absence is the
 * answer every frame recorded before this member gives.
 *
 * test-type: unit (frame builders only; no network, no clock, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { stepOriginOf } from "@animichi/contract/agent-step-origin";

import { framesFor, serverStepOpened } from "../src/agent/session/turn-frames.ts";

/** The three step names a deterministic bypass opens (`turn-selection.ts`). */
const BYPASS_STEPS = ["plan_selected", "plan_multi", "search_nearby"];

/** The frame that OPENS a step — the one the transcript shaper reads a call's
 * origin from, since it is where the call comes into existence. */
function openingFrame(frames: readonly Record<string, unknown>[]): Record<string, unknown> {
  const opened = frames.find((frame) => frame.type === "tool-input-start");
  assert.ok(opened !== undefined, "a step opens with tool-input-start");
  return opened;
}

for (const toolName of BYPASS_STEPS) {
  void test(`a server-opened ${toolName} step says the runtime asked for it`, () => {
    const opened = openingFrame(serverStepOpened(`${toolName}-call`, toolName));

    assert.deepEqual(opened, {
      type: "tool-input-start",
      toolCallId: `${toolName}-call`,
      toolName,
      toolMetadata: { origin: "server" },
    });
    assert.equal(stepOriginOf(opened), "server");
  });
}

void test("a model's own tool call carries no origin, and reads back as the model's", () => {
  const frames = framesFor({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "search_nearby",
    args: { place: "西宮" },
  });
  const opened = openingFrame(frames);

  assert.deepEqual(opened, { type: "tool-input-start", toolCallId: "call-1", toolName: "search_nearby" });
  assert.equal(stepOriginOf(opened), "model");
});

/**
 * The empty `input` is not what changed and must not change: it is the runtime's
 * honest answer for a step no model produced arguments for, and #1462 chose to
 * label it rather than to fill it in with the request (option 2, refused because
 * the frame would then claim an input the model never produced).
 */
void test("the marked step still opens with the empty input it always did", () => {
  const [, available] = serverStepOpened("plan_multi-call", "plan_multi");

  assert.deepEqual(available, {
    type: "tool-input-available",
    toolCallId: "plan_multi-call",
    toolName: "plan_multi",
    input: {},
  });
});
