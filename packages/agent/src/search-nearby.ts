import type { AgentHarnessTool, AgentHarnessToolInvocation } from "@earendil-works/pi-agent-core";
import { awaitWithContext, withCancel, type Context } from "@earendil-works/pi-agent-core/harness/context";
import type { GeocodeCandidate } from "@animichi/contract/contract";
import { Type, type Static } from "typebox";
import { authorizeInvocation, type PilgrimageToolContext } from "./tool-context.ts";
import { displayPoints } from "./search-result.ts";

const parameters = Type.Object({ location: Type.Optional(Type.String({ pattern: "\\S" })), radius_m: Type.Optional(Type.Integer({ exclusiveMinimum: 0 })) }, { additionalProperties: false });

/** Gazetteer and nearby reads are replay-safe; never infer a user's coordinates. */
export const searchNearby: AgentHarnessTool<PilgrimageToolContext, typeof parameters> = {
  name: "search_nearby", label: "Find nearby pilgrimage points", replay: "safe", parameters,
  description: "Search around a named place or the user's shared origin. Preserve offered coordinates and ambiguity.",
  async execute(_id, params, _update, tools, invocation, context) {
    const bounded = withCancel(context);
    const timer = setTimeout(() => { bounded.cancel(new DOMException("Nearby search exceeded 85 seconds", "TimeoutError")); }, 85_000);
    try {
      return await awaitWithContext(nearbyResult(tools, params, invocation, bounded.context), bounded.context);
    } finally { clearTimeout(timer); }
  },
};

async function nearbyResult(tools: PilgrimageToolContext, params: Static<typeof parameters>, invocation: AgentHarnessToolInvocation, context: Context) {
  await authorizeInvocation(tools, invocation, context);
  const origin = await locate(tools, params.location, context);
  if ("reason" in origin) return { content: [{ type: "text" as const, text: JSON.stringify(origin) }], details: origin };
  const result = await tools.catalog.nearby({ lat: origin.lat, lng: origin.lng, radius_m: params.radius_m ?? origin.radius }, { signal: context.abortSignal });
  const details = { kind: "nearby", anime_id: null, rows: displayPoints(result.rows, tools.locale), partial: false };
  const text = JSON.stringify({ outcome: details.rows.length ? "ok" : "empty", result_ref: invocation.invocationId, row_count: details.rows.length });
  return { content: [{ type: "text" as const, text }], details };
}

async function locate(tools: PilgrimageToolContext, location: string | undefined, context: Context) {
  if (!location) return tools.origin ? { ...tools.origin, radius: 5000 } : { reason: "missing_location", candidates: [] };
  const { candidates } = await tools.catalog.geocode({ query: location.trim(), limit: 5 }, { signal: context.abortSignal });
  const first = candidates[0];
  if (!first) return { reason: "unknown_place", candidates: [] };
  if (candidates.length > 1) return { reason: "place_ambiguity", candidates: candidates.map(offeredPlace) };
  if (first.kind === "prefecture") return { reason: "place_too_broad", candidates: [] };
  return { lat: first.lat, lng: first.lng, radius: first.effective_radius_m ?? 5000 };
}

function offeredPlace(place: GeocodeCandidate) {
  return { id: place.id, title: place.label, lat: place.lat, lng: place.lng,
    ...(place.effective_radius_m === undefined ? {} : { effective_radius_m: place.effective_radius_m }) };
}
