import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { authorizeInvocation, type PilgrimageToolContext } from "./tool-context.ts";
import { displayPoints, readSearchResult } from "./search-result.ts";

const parameters = Type.Object({ search_result_ref: Type.String({ minLength: 1 }),
  pacing: Type.Optional(Type.Union([Type.Literal("chill"), Type.Literal("normal"), Type.Literal("packed")])) }, { additionalProperties: false });

/** Catalog itinerary planning reads stored points; it does not book travel or persist an itinerary externally. */
export const planRoute: AgentHarnessTool<PilgrimageToolContext, typeof parameters> = {
  name: "plan_route", label: "Plan a walking route", replay: "safe", parameters,
  description: "Plan the exact catalog result identified by search_result_ref. Never invent a ref or point.",
  async execute(_id, params, _update, tools, invocation, context) {
    await authorizeInvocation(tools, invocation, context);
    const search = await readSearchResult(tools.session, tools.branch, params.search_result_ref, context);
    if (!search || search.partial || !search.rows.length) return unavailable(search);
    const itinerary = await tools.catalog.planItinerary({ point_ids: search.rows.map((point) => point.id), pacing: params.pacing, origin: tools.origin }, { signal: context.abortSignal });
    if (itinerary.ordered_points.some((point) => !search.rows.some((offered) => offered.id === point.id && offered.latitude === point.latitude && offered.longitude === point.longitude))) throw new Error("Catalog returned an unoffered route point");
    const details = { itinerary: { ...itinerary, ordered_points: displayPoints(itinerary.ordered_points, tools.locale) }, source_ref: params.search_result_ref };
    const text = JSON.stringify({ status: itinerary.point_count ? "ok" : "empty", itinerary_ref: invocation.invocationId, ordered_point_ids: itinerary.ordered_points.map((point) => point.id), point_count: itinerary.point_count, total_minutes: itinerary.timed_itinerary.total_minutes });
    return { content: [{ type: "text", text }], details };
  },
};

function unavailable(search: Awaited<ReturnType<typeof readSearchResult>>) {
  const details = { status: !search ? "stale_ref" : search.partial ? "pending_sync" : "empty" };
  return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
}
