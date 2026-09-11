import { ResolveOutcome } from "@animichi/contract/models";
import type { HookInvocation } from "@earendil-works/pi-agent-core";
import { z } from "zod";
import { Clarification, RouteDetails } from "./pilgrimage-projection.ts";

const RouteReference = z.object({ itinerary_ref: z.string() });
export const TOOL_RETURN_MAX_CHARS = 200;

/** Use typed domain outcomes; ordered identities are never sampled or truncated. */
export function toolSummaryText(event: HookInvocation<"after_tool">): string | undefined {
  const text = event.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
  if (text.length <= TOOL_RETURN_MAX_CHARS) return undefined;
  if (event.toolName === "resolve_anime") return resolveSummary(event.details);
  if (event.toolName === "plan_route") return routeSummary(event.details, text);
  if (event.toolName === "search_nearby") return placeSummary(event.details);
  return `[${event.toolName}: completed]`;
}

function resolveSummary(details: unknown): string {
  const result = ResolveOutcome.parse(details);
  if (result.outcome === "needs_disambiguation") return `[resolve_anime: ambiguous, ordered_candidates=${JSON.stringify(result.candidates.map((item) => item.bangumi_id))}]`;
  if (result.outcome === "resolved") return `[resolve_anime: resolved to ${result.match.title} (id=${result.match.bangumi_id})]`;
  return `[resolve_anime: ${result.outcome}]`;
}

function routeSummary(details: unknown, text: string): string {
  const route = RouteDetails.safeParse(details);
  if (!route.success) return "[plan_route: no route]";
  const reference = RouteReference.parse(JSON.parse(text) as unknown).itinerary_ref;
  const identity = `itinerary_ref=${reference}, ordered_stops=${JSON.stringify(route.data.itinerary.ordered_points.map((point) => point.id))}`;
  const duration = `, total_minutes=${String(route.data.itinerary.timed_itinerary.total_minutes)}`;
  const full = `[plan_route: ${identity}${duration}]`;
  return full.length <= TOOL_RETURN_MAX_CHARS ? full : `[plan_route: ${identity}]`;
}

function placeSummary(details: unknown): string {
  const clarification = Clarification.parse(details);
  return `[search_nearby: ambiguous, ordered_candidates=${JSON.stringify(clarification.candidates.map((item) => item.id))}]`;
}
