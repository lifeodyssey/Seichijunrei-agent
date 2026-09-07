/**
 * The recorded turns this package shapes, and the expectation beside each one.
 *
 * Two producers, deliberately, for the reason `dataset-roundtrip.ts` gives:
 * the `.sse` capture is the SUBJECT and `<name>.agent-result.json` is an
 * INDEPENDENT expectation, built by `record_fixtures.py` from the same turn
 * with the eval evaluators' own accessors. A shaper compared against a shape
 * typed by the same hand proves only that the hand was consistent.
 *
 * The transcript read is synthetic and lives here rather than beside the
 * captures: Python never served `GET /v1/conversations/{id}/messages` for these
 * turns, so there is nothing recorded to copy. It is parsed through the
 * contract's own `GetSessionHistoryResponse` so it cannot drift into a shape the
 * edge would never send.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GetSessionHistoryResponse } from "@animichi/contract/session-history-contract";

import {
  transcriptResultOf,
  turnFramesOf,
  type TranscriptResult,
  type TranscriptStep,
} from "../src/turn-transcript.ts";

/** The captures live where Python writes them; this package does not copy them. */
const CHAT_STREAM_DIR = new URL("../../../apps/agent/tests/fixtures/chat_stream/", import.meta.url);
const CAPTURES_DIR = new URL("../fixtures/captures/", import.meta.url);

/** The locale every recorded turn was requested with (`_RECORDED_LOCALE`). */
const RECORDED_LOCALE = "ja";

/** One text substitution applied to a capture before it is shaped, so a frame
 * pairing the recorder never produced can still be measured. */
export interface CaptureEdit {
  readonly replace: readonly string[];
  readonly with: readonly string[];
}

/**
 * One call as Python's recorder published it: the members its `AgentResult`
 * view carries. `params` is not among them and cannot be — `record_fixtures.py`
 * declares one `params` per replayed call and writes it as the frame's `args`,
 * so the capture's second witness lives in its own transcript read
 * (`<name>.messages.json`), where the edge would publish it.
 */
export type RecordedCall = Pick<TranscriptStep, "toolName" | "args" | "status">;

/** One shaped call, reduced to the members Python's recorder published. */
export function recordedCall(step: TranscriptStep): RecordedCall {
  return { toolName: step.toolName, args: step.args, status: step.status };
}

/** The evaluator view of one turn, as `record_fixtures.py` writes it. */
export interface PythonEvaluatorView {
  readonly intent: string;
  readonly success: boolean;
  readonly message: string;
  readonly locale: string;
  readonly dataKeys: readonly string[];
  readonly stepCount: number;
  readonly tools: readonly string[];
  readonly trajectory: readonly RecordedCall[];
}

/** The captures that answered. `error` has no expectation — its handler raises
 * before an `AgentResult` exists — so it is asserted against the contract. */
export function answeredCaptureNames(): readonly string[] {
  return ["search", "clarify"];
}

function read(base: URL, name: string): string {
  return readFileSync(fileURLToPath(new URL(name, base)), "utf8");
}

function edited(stream: string, edit: CaptureEdit | undefined): string {
  if (edit === undefined) return stream;
  return edit.replace.reduce((text, needle, index) => text.replace(needle, edit.with[index] ?? ""), stream);
}

/** One capture shaped exactly as the staging task shapes a live turn. */
export function shapedCapture(name: string, edit?: CaptureEdit): TranscriptResult {
  return transcriptResultOf({
    frames: turnFramesOf(edited(read(CHAT_STREAM_DIR, `${name}.sse`), edit)),
    priorTrajectory: [],
    history: GetSessionHistoryResponse.parse(JSON.parse(read(CAPTURES_DIR, `${name}.messages.json`))),
    locale: RECORDED_LOCALE,
  });
}

interface WireEvaluatorView {
  readonly intent: string;
  readonly success: boolean;
  readonly message: string;
  readonly locale: string;
  readonly data_keys: readonly string[];
  readonly step_count: number;
  readonly tools: readonly string[];
  readonly trajectory: readonly { tool_name: string; args: Record<string, unknown>; status: string }[];
}

/** Python's expectation, in this package's own vocabulary. Only the KEYS are
 * translated — every value is Python's, untouched. */
export function pythonEvaluatorView(name: string): PythonEvaluatorView {
  const raw = JSON.parse(read(CHAT_STREAM_DIR, `${name}.agent-result.json`)) as WireEvaluatorView;
  return {
    intent: raw.intent,
    success: raw.success,
    message: raw.message,
    locale: raw.locale,
    dataKeys: raw.data_keys,
    stepCount: raw.step_count,
    tools: raw.tools,
    trajectory: raw.trajectory.map((step) => ({
      toolName: step.tool_name,
      args: step.args,
      status: step.status === "ok" ? "ok" : "unsettled",
    })),
  };
}
