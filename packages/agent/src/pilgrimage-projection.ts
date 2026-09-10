import { ExecutionWitness } from "./execution-witness.ts";
import { ResolveOutcome, Itinerary } from "@animichi/contract/models";
import type { Entry } from "@earendil-works/pi-agent-core/harness/session";
import { z } from "zod";
import { SearchResultDetails } from "./search-result.ts";
import { readSelectionEntry, type SelectionEntry } from "./selection-entry.ts";
import { FrozenSummary, ExecutedFacts } from "./tool-context-annotations.ts";

export const Clarification = z.object({ execution: ExecutionWitness.optional(), frozenSummary: FrozenSummary.optional(), executedFacts: ExecutedFacts.optional(), reason: z.string(), candidates: z.array(z.object({
  id: z.string(), title: z.string(), cover_url: z.string().optional(), points_count: z.number().optional(),
  lat: z.number().optional(), lng: z.number().optional(), effective_radius_m: z.number().optional(),
}).strict()) }).strict();
export const RouteDetails = z.object({ execution: ExecutionWitness.optional(), frozenSummary: FrozenSummary.optional(), executedFacts: ExecutedFacts.optional(), itinerary: Itinerary, source_ref: z.string() }).strict();

interface PilgrimageState {
  clarification: (z.infer<typeof Clarification> & { id: number; entryId: string }) | undefined;
  currentAnime: { bangumiId: string; title: string } | undefined;
}

/** Recompute domain state from committed branch entries; no separate mutable payload store exists. */
export function projectPilgrimage(entries: readonly Entry[]): PilgrimageState {
  return [...entries].sort((left, right) => left.seq - right.seq).reduce(projectEntry, { clarification: undefined, currentAnime: undefined });
}

function projectEntry(state: PilgrimageState, entry: Entry): PilgrimageState {
  const selection = readSelectionEntry(entry);
  if (selection) return selectedState(state, selection.result);
  const result = domainResult(entry);
  if (!result) return state;
  return { currentAnime: result.currentAnime ?? state.currentAnime,
    clarification: result.clarification ? { ...result.clarification, id: entry.seq, entryId: entry.id } : undefined };
}

function selectedState(state: PilgrimageState, selection: SelectionEntry["result"]): PilgrimageState {
  const success = selection.status === "ok" || (selection.step === "search_nearby" && selection.status === "empty");
  if (!success || state.clarification?.id !== selection.clarificationId) return state;
  return { clarification: undefined, currentAnime: selection.step === "plan_multi" ? selection.currentAnime ?? undefined : state.currentAnime };
}

function domainResult(entry: Entry) {
  if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.isError) return undefined;
  const { toolName } = entry.message;
  const details: unknown = entry.message.details;
  if (toolName === "resolve_anime") return resolveState(details);
  const clarification = Clarification.safeParse(details);
  if (toolName === "search_nearby" && clarification.success) return { clarification: clarification.data, currentAnime: undefined };
  if (clearsClarification(toolName, details)) return { clarification: undefined, currentAnime: undefined };
  return undefined;
}

function clearsClarification(name: string, details: unknown): boolean {
  if (["search_bangumi", "search_nearby"].includes(name)) return SearchResultDetails.safeParse(details).success;
  if (name === "plan_route") return RouteDetails.safeParse(details).success;
  return name === "respond" && z.object({ intent: z.string().refine((intent) => intent !== "clarify") }).safeParse(details).success;
}

function resolveState(details: unknown) {
  const result = ResolveOutcome.safeParse(details);
  if (!result.success) return undefined;
  if (result.data.outcome === "resolved") return { currentAnime: { bangumiId: result.data.match.bangumi_id, title: result.data.match.title }, clarification: undefined };
  if (result.data.outcome === "upstream_unavailable") return { currentAnime: undefined, clarification: undefined };
  const candidates = result.data.outcome === "needs_disambiguation" ? result.data.candidates.map((item) => ({
    id: item.bangumi_id, title: [item.title, item.title_cn].find((title) => title !== undefined && title !== "") ?? item.bangumi_id,
    ...(item.cover_url ? { cover_url: item.cover_url } : {}), ...(item.points_count !== undefined ? { points_count: item.points_count } : {}),
  })) : [];
  return { currentAnime: undefined, clarification: { reason: result.data.reason, candidates } };
}
