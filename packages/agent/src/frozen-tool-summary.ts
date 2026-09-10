import type { AgentMessage, HookInvocation } from "@earendil-works/pi-agent-core";
import { FrozenSummary } from "./tool-context-annotations.ts";
import { executedToolFacts } from "./executed-tool-facts.ts";
import { toolSummaryText } from "./tool-summary-text.ts";

/** Preserve the complete tool payload and freeze only its later-turn presentation. */
export function annotateToolContext(event: HookInvocation<"after_tool">) {
  const details = event.details;
  if (event.toolName === "web_search") return undefined;
  if (event.isError || !details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const frozenSummary = toolSummaryText(event);
  const executedFacts = executedToolFacts(event, frozenSummary !== undefined);
  if (!frozenSummary && !executedFacts) return undefined;
  return { details: { ...details, ...(frozenSummary ? { frozenSummary } : {}), ...(executedFacts ? { executedFacts } : {}) } };
}

/** The native message content remains untouched until it belongs to a prior user turn. */
export function applyFrozenSummaries(messages: AgentMessage[]): AgentMessage[] {
  const currentTurn = messages.map((message) => message.role).lastIndexOf("user");
  return messages.map((message, index) => index < currentTurn ? frozenMessage(message) : message);
}

function frozenMessage(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult" || !message.details || typeof message.details !== "object" || Array.isArray(message.details)) return message;
  const summary = FrozenSummary.safeParse(Reflect.get(message.details, "frozenSummary"));
  if (!summary.success) return message;
  return { ...message, content: [{ type: "text", text: summary.data }, ...message.content.filter((part) => part.type !== "text")] };
}
