import { historySteps } from "./history-steps.ts";
import { historyOperations } from "./history-operations.ts";
import { ChatResponseDataPart } from "@animichi/contract";
import type { GetSessionHistoryResponse, SessionHistoryMessage, SessionRunStatus } from "@animichi/contract/session-history-contract";
import { NeonStorage } from "@animichi/pi-session-neon";
import { branchTip, laneState, operationResult, type Entry, type Storage, type Session } from "@earendil-works/pi-agent-core/harness/session";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/pi-agent-core/harness/context";
import { readSelectionEntry } from "@animichi/agent/selection-entry";
import type { AdmissionDatabase } from "../admission/types.ts";
import { SecretScrub } from "../egress/secret-scrub.ts";
import { domainPayload, messageText } from "./public-content.ts";

export interface HistoryPage { offset: number; limit: number }
const scrub = new SecretScrub();

/** Direct native Storage reads only: browsing never constructs a harness or wakes a Durable Object. */
export async function readNativeHistory(db: AdmissionDatabase, sessionId: string, identityId: string, page: HistoryPage): Promise<GetSessionHistoryResponse | null> {
  const owners = await db.runtime().query(db.raw.sql`SELECT user_id AS owner FROM sessions WHERE id = ${sessionId}`.returnsRow({ owner: { codecId: "pg/text@1", nullable: true } }).build());
  if (owners[0]?.owner !== identityId) return null;
  const storage = new NeonStorage(db, { sessionId });
  try { return await readHistoryStorage(storage, page, BACKGROUND_CONTEXT); }
  finally { await storage.close(BACKGROUND_CONTEXT); }
}

export async function readHistoryStorage(storage: Storage | Session, page: HistoryPage, context: Context): Promise<GetSessionHistoryResponse> {
  const tip = await storage.getValue(branchTip("main"), context);
  const entries = tip?.value ? await storage.scanBranch({ start: tip.value, order: "oldestFirst" }, context) : [];
  const operations = await historyOperations(storage, entries, context);
  const all = entries.flatMap((entry) => historyMessage(entry).map((message) => ({ entry,
    message: { ...message, ...(operations.has(entry.id) ? { operation_id: operations.get(entry.id) } : {}) } })));
  const next = page.offset + page.limit;
  return { messages: all.slice(page.offset, next).map((item) => item.message), revision: entries.at(-1)?.seq ?? 0,
    next_offset: all.length > next && next <= 1000 ? next : null, run: await historyRun(storage, context), steps: historySteps(entries, all.slice(page.offset, next).map((item) => item.entry)) };
}

async function historyRun(storage: Storage | Session, context: Context): Promise<SessionRunStatus | null> {
  const state = (await storage.getValue(laneState("main"), context))?.value;
  const id = state?.currentOperationId ?? state?.lastOperationId;
  if (!id) return null;
  const result = (await storage.getValue(operationResult(id), context))?.value;
  if (!result) return { run_id: id, status: "running" };
  if (result.status === "completed") return { run_id: id, status: "succeeded" };
  return { run_id: id, status: "failed", reason: result.status === "aborted" ? "cancelled" : "internal_error" };
}

function publicAnswer(details: unknown, timestamp: number): SessionHistoryMessage[] {
  const parsed = ChatResponseDataPart.safeParse(domainPayload(details));
  if (!parsed.success) return [];
  return [{ role: "assistant", content: scrub.text(parsed.data.message ?? ""),
    response_data: { intent: parsed.data.intent, success: parsed.data.success ?? true }, created_at: new Date(timestamp).toISOString() }];
}

function historyMessage(entry: Entry): SessionHistoryMessage[] {
  if (entry.type === "custom") {
    try { const selected = readSelectionEntry(entry); return selected ? publicAnswer(selected.result.response, entry.timestamp) : []; }
    catch { return []; }
  }
  if (entry.type !== "message") return [];
  const message = entry.message;
  if (message.role === "toolResult") return message.toolName === "respond" && !message.isError ? publicAnswer(message.details, entry.timestamp) : [];
  if (message.role !== "user" && message.role !== "assistant") return [];
  return proseMessage(message, entry.timestamp);
}

function proseMessage(message: Extract<import("@earendil-works/pi-agent-core").AgentMessage, { role: "user" | "assistant" }>, timestamp: number): SessionHistoryMessage[] {
  const calls = message.role === "assistant" ? message.content.filter((part) => part.type === "toolCall") : [];
  const text = scrub.text(messageText(message));
  const content = calls.length ? JSON.stringify({ content: text, tool_calls: calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: scrub.text(JSON.stringify(call.arguments)) } })) }) : text;
  return content ? [{ role: message.role, content, created_at: new Date(timestamp).toISOString(), response_data: null }] : [];
}
