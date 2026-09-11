import { ExecutionWitness } from "@animichi/agent/execution-witness";
import type { Entry } from "@earendil-works/pi-agent-core/harness/session";
import { operationView } from "./snapshot-view.ts";
import type { HarnessEvent, LaneSnapshot } from "@earendil-works/pi-agent-core";
import type { UIMessageChunk } from "ai";
import type { SecretScrub } from "../egress/secret-scrub.ts";
import { publicValue, responseChunks, SAFE_FAILURE } from "./public-content.ts";

export function toolInput(toolCallId: string, toolName: string, args: unknown, scrub: SecretScrub): UIMessageChunk[] {
  if (toolName === "respond") return [];
  return [{ type: "tool-input-start", toolCallId, toolName }, { type: "tool-input-available", toolCallId, toolName, input: publicValue(args, scrub) }];
}

export function eventChunks(event: HarnessEvent, sessionId: string, scrub: SecretScrub): UIMessageChunk[] {
  if (event.type === "tool_start") return toolInput(event.toolCallId, event.toolName, event.args, scrub);
  if (event.type === "tool_end") return toolEnd(event, sessionId, scrub);
  if (event.type === "run_end") return finishChunks(event.status);
  if (event.type === "fault") return [{ type: "error", errorText: SAFE_FAILURE }];
  if (event.type === "usage") return [{ type: "data-usage", transient: true, data: { input: event.totals.input, output: event.totals.output, totalTokens: event.totals.totalTokens, cost: event.totals.cost.total } }];
  return [];
}

function toolEnd(event: Extract<HarnessEvent, { type: "tool_end" }>, sessionId: string, scrub: SecretScrub): UIMessageChunk[] {
  return toolOutput(event.toolCallId, event.toolName, event.result.details, event.isError, sessionId, scrub);
}

function toolOutput(id: string, name: string, details: unknown, isError: boolean, sessionId: string, scrub: SecretScrub): UIMessageChunk[] {
  if (isError) return name === "respond" ? [] : [{ type: "tool-output-error", toolCallId: id, errorText: SAFE_FAILURE }];
  if (name === "respond") return responseChunks(details, sessionId, scrub);
  return [{ type: "tool-output-available", toolCallId: id, output: publicValue(details, scrub) }];
}

function committedTool(entry: Entry, sessionId: string, scrub: SecretScrub): UIMessageChunk[] {
  if (entry.type !== "message" || entry.message.role !== "toolResult") return [];
  const { toolCallId, toolName, isError } = entry.message;
  const details: unknown = entry.message.details;
  const witness = ExecutionWitness.safeParse(details && typeof details === "object" ? Reflect.get(details, "execution") : undefined);
  const input = witness.success && witness.data.toolCallId === toolCallId ? toolInput(toolCallId, toolName, witness.data.args, scrub) : [];
  return [...input, ...toolOutput(toolCallId, toolName, details, isError, sessionId, scrub)];
}

export function finishChunks(status: string): UIMessageChunk[] {
  const failure: UIMessageChunk[] = status === "completed" ? [] : [{ type: "error", errorText: SAFE_FAILURE }];
  return [...failure, { type: "finish-step" }, { type: "finish", finishReason: status === "completed" ? "stop" : "error" }];
}

/** Restore only the requested operation; a newer turn must never stand in for its answer. */
export function snapshotChunks(snapshot: LaneSnapshot, sessionId: string, operationId: string, scrub: SecretScrub): UIMessageChunk[] {
  const { operation, result, entries } = operationView(snapshot, operationId);
  if (!operation && !result) return finishChunks("failed");
  const chunks = entries.flatMap((entry) => committedTool(entry, sessionId, scrub));
  for (const tool of operation?.runningTools ?? []) {
    chunks.push(...toolInput(tool.toolCallId, tool.toolName, tool.args, scrub));
    if (tool.status === "settled") chunks.push(...toolOutput(tool.toolCallId, tool.toolName, tool.result.details, tool.isError, sessionId, scrub));
  }
  if (result) chunks.push(...finishChunks(result.status));
  return chunks;
}
