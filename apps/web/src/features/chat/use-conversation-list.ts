import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { authHeaders } from "../../lib/auth/auth-session";

/**
 * GET /v1/conversations — the agent's compact session list (SESSION-3 #961).
 * The route returns `SQLModelSessionRepository.list_sessions` rows verbatim;
 * the domain row is a total=False TypedDict, so every field but the id may be
 * absent or null and the schema models exactly that.
 */
const ConversationListRow = z.object({
  session_id: z.string(),
  title: z.string().nullable().optional(),
  first_query: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

const ConversationListResponse = z.array(ConversationListRow);

export interface ConversationSummary {
  readonly id: string;
  /** The row's title, falling back to the first query it ever answered. */
  readonly title: string;
  /** The first query, as the anime-subtitle line under the title. */
  readonly subtitle: string;
}

export type ConversationListStatus = "idle" | "loading" | "error" | "success";

export interface ConversationList {
  readonly status: ConversationListStatus;
  readonly conversations: readonly ConversationSummary[];
}

function toSummary(row: z.infer<typeof ConversationListRow>): ConversationSummary {
  const fallback = row.first_query ?? "";
  return {
    id: row.session_id,
    title: row.title ?? fallback,
    subtitle: row.title !== null && row.title !== undefined ? fallback : "",
  };
}

async function fetchConversations(baseUrl: string): Promise<readonly ConversationSummary[]> {
  const headers = await authHeaders();
  const response = await fetch(`${baseUrl}/v1/conversations`, { headers });
  if (!response.ok) throw new Error(`conversations responded ${String(response.status)}`);
  const payload: unknown = await response.json();
  return ConversationListResponse.parse(payload).map(toSummary);
}

function listQueryOptions(baseUrl: string, enabled: boolean) {
  return {
    queryKey: ["chat", "conversations", baseUrl],
    queryFn: () => fetchConversations(baseUrl),
    enabled,
  };
}

function toStatus(query: { isSuccess: boolean; isError: boolean }, enabled: boolean): ConversationListStatus {
  if (!enabled) return "idle";
  if (query.isError) return "error";
  return query.isSuccess ? "success" : "loading";
}

function toConversationList(
  query: { data: readonly ConversationSummary[] | undefined; isSuccess: boolean; isError: boolean },
  enabled: boolean,
): ConversationList {
  return {
    status: toStatus(query, enabled),
    conversations: query.data ?? [],
  };
}

/**
 * The sidebar's RECENT rows. Signed out the query stays idle (the endpoint is
 * authenticated-only); an empty list or a failed call renders as no rows, the
 * way `useConversationHistory` treats its own failure as a status, never as
 * fabricated data. No `retry` handle: the sidebar offers no error surface, so
 * a failed list simply stays empty until the next mount refetches.
 */
export function useConversationList(baseUrl: string, authenticated: boolean): ConversationList {
  const query = useQuery(listQueryOptions(baseUrl, authenticated));
  return toConversationList(query, authenticated);
}
