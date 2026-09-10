import type { HookInvocation } from "@earendil-works/pi-agent-core";
import { z } from "zod";

export const ExecutionWitness = z.object({ operationId: z.string(), toolCallId: z.string(), args: z.record(z.string(), z.json()) }).strict();

/** Native after_tool receives validated effective args; the SDK persists these with this tool result. */
export function annotateExecution(event: HookInvocation<"after_tool">) {
  const details = event.details;
  if (details !== undefined && (details === null || typeof details !== "object" || Array.isArray(details))) throw new Error("Native tool details must use their declared object shape");
  return { details: { ...details, execution: ExecutionWitness.parse({ operationId: event.runId, toolCallId: event.toolCallId, args: event.args }) } };
}
