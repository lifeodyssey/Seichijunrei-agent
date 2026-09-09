/**
 * `resolve_anime` — free text to a deterministic anime identity.
 *
 * Port of `animichi_tools.py::resolve_anime` × `catalog_tools.py::run_resolve`.
 * The description is the docstring the model reads today, kept word-for-word so
 * the eval trajectories and the system prompt still describe this tool.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AnimeCandidate } from "@animichi/contract";
import type { CatalogClient } from "./catalog-client.ts";
import { degradingCatalogFailure } from "./catalog-failure-degradation.ts";
import type { ToolBudget } from "./catalog-timeouts.ts";
import type { CatalogToolSession, OrderedCandidate } from "./catalog-tool-session.ts";
import type { ResolveOutcome as ToolOutcome, ToolDetails } from "./catalog-tool-outcomes.ts";
import { UPSTREAM_DOWN } from "./catalog-tool-outcomes.ts";
import { looksLikeWrongVariant } from "@animichi/agent";
import { resolveAnimeParameters } from "./tool-schema-bridge.ts";

const DESCRIPTION = `Resolve an anime title to a deterministic outcome.

\`resolved\` means call \`search_bangumi\` with its ID. For \`needs_disambiguation\`, emit \`clarify_response\` with the supplied reason and candidate IDs. For \`not_found\`, emit \`clarify_response\` asking for a corrected title. For \`upstream_unavailable\`, emit \`qa_response\` asking the user to retry. Never infer ambiguity from query length.

Do not call this again once an anime is already resolved this turn or session — call \`search_bangumi\` directly with the known bangumi_id instead.`;

/** The first title that is actually written, the way Python's `or` chain
 * picked one: an empty string is no title at all, so `??` would be wrong. */
function firstWrittenTitle(candidate: AnimeCandidate): string | undefined {
  return [candidate.title, candidate.title_cn].find((value) => Boolean(value));
}

/** One catalog candidate as a choice the user can be offered. */
function orderedCandidate(candidate: AnimeCandidate): OrderedCandidate {
  return {
    id: candidate.bangumi_id,
    title: firstWrittenTitle(candidate) ?? candidate.bangumi_id,
    cover_url: candidate.cover_url,
    points_count: candidate.points_count,
  };
}

/** Nothing matched: the next turn must ask for a corrected title. */
function notFound(session: CatalogToolSession): ToolOutcome {
  session.setPendingClarification("anime_not_found", []);
  return { outcome: "not_found", clarification_reason: "anime_not_found" };
}

/** Exactly one match — unless it is a different entry in the same series. */
function resolved(session: CatalogToolSession, match: AnimeCandidate, query: string): ToolOutcome {
  if (looksLikeWrongVariant(query, [match.title, match.title_cn])) return notFound(session);
  session.clearPendingClarification();
  const title = firstWrittenTitle(match) ?? "";
  session.setCurrentAnime({ bangumiId: match.bangumi_id, title });
  return { outcome: "resolved", bangumi_id: match.bangumi_id, anime_title: title };
}

/** Several matches: the next turn must ask the user to choose. */
function ambiguous(session: CatalogToolSession, candidates: AnimeCandidate[]): ToolOutcome {
  const ordered = candidates.map(orderedCandidate);
  session.setPendingClarification("anime_ambiguity", ordered);
  return {
    outcome: "needs_disambiguation",
    clarification_reason: "anime_ambiguity",
    candidate_ids: ordered.map((candidate) => candidate.id),
  };
}

/** Adapt the catalog's own resolution partition to the model's. */
async function resolveTitle(
  catalog: CatalogClient,
  session: CatalogToolSession,
  title: string,
  signal?: AbortSignal,
): Promise<ToolOutcome> {
  const outcome = await catalog.resolve(title, signal);
  if (outcome.outcome === "resolved") return resolved(session, outcome.match, title);
  if (outcome.outcome === "needs_disambiguation") return ambiguous(session, outcome.candidates);
  if (outcome.outcome === "not_found") return notFound(session);
  session.clearPendingClarification();
  return UPSTREAM_DOWN;
}

/** Build `resolve_anime` over one session's catalog and state. */
export function resolveAnimeTool(
  catalog: CatalogClient,
  session: CatalogToolSession,
  budget: ToolBudget,
): AgentTool<typeof resolveAnimeParameters, ToolDetails<ToolOutcome>> {
  return {
    name: "resolve_anime",
    label: "Resolve an anime title",
    description: DESCRIPTION,
    parameters: resolveAnimeParameters,
    // The title is trimmed here because the catalog's own `ResolveInput.query`
    // is `.trim().min(1)` and the trim half of that cannot ride in a JSON
    // Schema (`packages/contract/src/agent-tool-parameters.ts`): the schema
    // refuses a blank title, and this refuses to send the catalog a padded one.
    execute: (_toolCallId, params, signal) =>
      degradingCatalogFailure("resolve_anime", () => UPSTREAM_DOWN, (deadline) =>
        resolveTitle(catalog, session, params.title.trim(), deadline), budget, signal),
  };
}
