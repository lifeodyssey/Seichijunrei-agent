import { ChatResponseDataPart } from "@animichi/contract";
import type { UIMessageChunk } from "ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Entry } from "@earendil-works/pi-agent-core/harness/session";
import type { SecretScrub, ScrubbableValue } from "../egress/secret-scrub.ts";

export const SAFE_FAILURE = "Something went wrong. Please try again.";
const PRIVATE_FIELD = /secret|authorization|api.?key|token|password|credential|source_ref|result_ref|execution|frozenSummary|executedFacts/i;

/** Only JSON primitives cross the view boundary; credentials and internal handles never do. */
export function publicValue(value: unknown, scrub: SecretScrub): ScrubbableValue {
  if (typeof value === "string") return scrub.text(value);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item: unknown) => publicValue(item, scrub));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => item !== undefined && !PRIVATE_FIELD.test(key)).map(([key, item]: [string, unknown]) => [key, publicValue(item, scrub)]));
}

export function responseChunks(details: unknown, sessionId: string, scrub: SecretScrub): UIMessageChunk[] {
  const parsed = ChatResponseDataPart.safeParse(domainPayload(details));
  if (!parsed.success) return [{ type: "error", errorText: SAFE_FAILURE }];
  const { intent, status, message, data, success, ui, generated_title } = parsed.data;
  const allowed = publicValue({ intent, status, message, data, success, ui, generated_title, session_id: sessionId }, scrub);
  return [{ type: "data-response", id: "response", data: { intent } }, { type: "data-response", id: "response", data: allowed }];
}

export function messageText(message: AgentMessage): string {
  if (!("content" in message)) return "";
  if (!Array.isArray(message.content)) return typeof message.content === "string" ? message.content : "";
  return message.content.flatMap((part) => part.type === "text" ? part.text : []).join("");
}

export function entryAnswer(entry: Entry, sessionId: string, scrub: SecretScrub): UIMessageChunk[] {
  if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.toolName !== "respond" || entry.message.isError) return [];
  return responseChunks(entry.message.details, sessionId, scrub);
}

/** Presentation reads domain fields alongside the explicitly declared native annotations. */
export function domainPayload(details: unknown): unknown {
  if (!details || typeof details !== "object" || Array.isArray(details)) return details;
  const { execution: _execution, frozenSummary: _summary, executedFacts: _facts, ...payload } = details as Record<string, unknown>;
  return payload;
}
