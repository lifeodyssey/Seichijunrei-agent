import { HIDDEN_TOOL_STEPS } from "./i18n";
import type { ChatUIMessage } from "./use-chat-session";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { GetSessionHistoryResponse } from "@animichi/contract";
import { authHeaders } from "../../lib/auth/auth-session";
import { conversationMessagesUrl } from "./config";

export interface HistoryEntry {
  readonly role: string;
  readonly content: string;
  readonly intent?: string;
  readonly operationId?: string;
}

export interface HistoryPage {
  readonly entries: readonly HistoryEntry[];
  readonly revision: number;
}

export type ConversationHistoryStatus = "idle" | "loading" | "error" | "success";

export interface ConversationHistory {
  readonly status: ConversationHistoryStatus;
  readonly entries: readonly HistoryEntry[];
  readonly revision: number;
  readonly retry: () => void;
}

function toEntry(row: { readonly role: string; readonly content: string; readonly operation_id?: string; readonly response_data?: { readonly intent?: string | null } | null }): HistoryEntry {
  return { role: row.role, content: row.content, intent: row.response_data?.intent ?? undefined, operationId: row.operation_id };
}

/** The native snapshot supplies this operation's assistant state; retain its prompt and all other history. */
export function withoutSnapshotAssistant(history: ConversationHistory, operationId: string | undefined): ConversationHistory {
  if (!operationId) return history;
  return { ...history, entries: history.entries.filter((entry) => entry.role !== "assistant" || entry.operationId !== operationId) };
}

/** Anonymous when signed out (existing behaviour); adds a Bearer token once signed in.
 * Native history restores committed prompts and preceding operations; current
 * assistant state comes from the separate SDK snapshot/live stream. */
export async function fetchHistory(baseUrl: string, sessionId: string): Promise<HistoryPage> {
  const headers = await authHeaders();
  const response = await fetch(conversationMessagesUrl(baseUrl, sessionId), { headers });
  if (!response.ok) throw new Error(`messages responded ${String(response.status)}`);
  const payload: unknown = await response.json();
  const parsed = GetSessionHistoryResponse.parse(payload);
  return { entries: parsed.messages.map(toEntry), revision: parsed.revision };
}

function historyQueryOptions(baseUrl: string, sessionId?: string) {
  return {
    queryKey: ["chat", "history", baseUrl, sessionId],
    queryFn: () => fetchHistory(baseUrl, sessionId ?? ""),
    enabled: sessionId !== undefined,
  };
}

function toStatus(
  query: { isSuccess: boolean; isError: boolean },
  enabled: boolean,
): ConversationHistoryStatus {
  if (!enabled) return "idle";
  if (query.isError) return "error";
  return query.isSuccess ? "success" : "loading";
}

function toConversationHistory(
  query: { data: HistoryPage | undefined; isSuccess: boolean; isError: boolean },
  sessionId: string | undefined,
): Omit<ConversationHistory, "retry"> {
  return {
    status: toStatus(query, sessionId !== undefined),
    entries: query.data?.entries ?? [],
    revision: query.data?.revision ?? 0,
  };
}

/**
 * A3: restore a historical session via `GET /v1/conversations/{id}/messages`.
 * Failures are surfaced as an explicit error status — never as an empty,
 * writable-looking session.
 */
export function useConversationHistory(baseUrl: string, sessionId?: string): ConversationHistory {
  const query = useQuery(historyQueryOptions(baseUrl, sessionId));
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  return { ...toConversationHistory(query, sessionId), retry };
}

/** Identity headers are not a replacement: keep history until the SDK has visible assistant content. */
export function snapshotOperationId(messages: readonly ChatUIMessage[], operationId: string | undefined): string | undefined {
  const snapshot = messages.find((message) => message.role === "assistant" && message.id === operationId);
  return snapshot?.parts.some(displayedSnapshotPart) ? operationId : undefined;
}

function displayedSnapshotPart(part: ChatUIMessage["parts"][number]): boolean {
  if (part.type === "text") return part.text.length > 0;
  if (part.type === "data-response") return true;
  return part.type.startsWith("tool-") && !HIDDEN_TOOL_STEPS.has(part.type.slice(5));
}
