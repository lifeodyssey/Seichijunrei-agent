import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { serverStepOrigin } from "@animichi/contract/agent-step-origin";
import type { SelectionOutcome } from "../selection/native-selection.ts";
import { modelAdmissionResponse } from "../../gateway/native-admission-response.ts";
import { SecretScrub } from "../egress/secret-scrub.ts";
import { publicValue, responseChunks } from "./public-content.ts";

/** A committed native custom entry supplies the deterministic result and server origin. */
export function selectionResponse(outcome: SelectionOutcome, sessionId: string): Response {
  if (outcome.kind === "rejected") return Response.json({ error: { code: "selection_refused" } }, { status: 409 });
  if (outcome.kind !== "settled") return modelAdmissionResponse({ kind: outcome.kind === "pending" ? "blocked" : outcome.kind, operationId: null }, sessionId);
  const { result, entryId: toolCallId } = outcome;
  const scrub = new SecretScrub();
  return createUIMessageStreamResponse({ headers: { "x-session-id": sessionId, "cache-control": "no-store" }, stream: createUIMessageStream({ execute: ({ writer }) => {
    writer.write({ type: "start", messageId: toolCallId });
    writer.write({ type: "start-step" });
    writer.write({ type: "tool-input-start", toolCallId, toolName: result.step, ...serverStepOrigin() });
    writer.write({ type: "tool-input-available", toolCallId, toolName: result.step, input: publicValue(result.request, scrub), ...serverStepOrigin() });
    writer.write({ type: "tool-output-available", toolCallId, output: { status: result.status } });
    for (const chunk of responseChunks(result.response, sessionId, scrub)) writer.write(chunk);
    writer.write({ type: "finish-step" });
    writer.write({ type: "finish", finishReason: "stop" });
  } }) });
}
