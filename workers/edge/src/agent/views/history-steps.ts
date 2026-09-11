import { ExecutionWitness } from "@animichi/agent/execution-witness";
import type { Entry } from "@earendil-works/pi-agent-core/harness/session";
import type { SessionHistoryStep } from "@animichi/contract/session-history-contract";
import { publicValue } from "./public-content.ts";
import { SecretScrub } from "../egress/secret-scrub.ts";

/** Match the durable effective-argument annotation to a tool call on this visible branch page. */
export function historySteps(entries: readonly Entry[], visible: readonly Entry[]): SessionHistoryStep[] {
  const calls = new Map(visible.flatMap((entry) => entry.type === "message" && entry.message.role === "assistant"
    ? entry.message.content.flatMap((part) => part.type === "toolCall" ? [[part.id, part.name] as const] : []) : []));
  return entries.flatMap((entry) => stepOf(entry, calls));
}

function stepOf(entry: Entry, calls: ReadonlyMap<string, string>): SessionHistoryStep[] {
  if (entry.type !== "message" || entry.message.role !== "toolResult") return [];
  const { toolCallId, toolName } = entry.message;
  const details: unknown = entry.message.details;
  if (calls.get(toolCallId) !== toolName || !details || typeof details !== "object") return [];
  const execution = ExecutionWitness.safeParse(Reflect.get(details, "execution"));
  if (!execution.success || execution.data.toolCallId !== toolCallId) return [];
  return [{ run_id: execution.data.operationId, step_index: entry.seq, tool_name: toolName,
    params: JSON.stringify(publicValue(execution.data.args, new SecretScrub())) }];
}
