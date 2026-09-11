import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Point } from "@animichi/contract/models";
import { ORPCError } from "@orpc/client";
import type { createCatalogClient } from "./catalog-client.ts";
import type { projectPilgrimage } from "./pilgrimage-projection.ts";
import { displayPoints } from "./search-result.ts";
import type { SelectionRequest } from "./selection-input.ts";
import { selectionResult } from "./selection-outcome.ts";
import { planSelectedPoints } from "./selection-route.ts";

type Request = Extract<SelectionRequest, { of: "candidates" }>;
type Pending = NonNullable<ReturnType<typeof projectPilgrimage>["clarification"]>;

async function fetchWorks(request: Request, catalog: ReturnType<typeof createCatalogClient>, context: Context) {
  const fetched = await Promise.allSettled(request.candidateIds.map((bangumi_id) => catalog.pointsByBangumiId({ bangumi_id }, { signal: context.abortSignal })));
  context.abortSignal?.throwIfAborted();
  return fetched.flatMap((outcome, index) => outcome.status === "fulfilled" ? [{ id: request.candidateIds[index], result: outcome.value }] : []);
}

function mergedWorks(fetched: Awaited<ReturnType<typeof fetchWorks>>) {
  const points = new Map<string, Point>(), contributors = new Set<string | undefined>();
  for (const work of fetched) {
    const before = points.size;
    mergePoints(points, work.result.rows);
    if (points.size > before) contributors.add(work.id);
  }
  return { points: [...points.values()], contributors };
}

function mergePoints(points: Map<string, Point>, rows: Point[]) {
  for (const point of rows) {
    if (!points.has(point.id)) points.set(point.id, point);
  }
}

export async function multiSelection(request: Request, pending: Pending, catalog: ReturnType<typeof createCatalogClient>, context: Context) {
  const fetched = await fetchWorks(request, catalog, context), merged = mergedWorks(fetched);
  const omitted = request.candidateIds.filter((id) => !merged.contributors.has(id)).map((id) => pending.candidates.find((candidate) => candidate.id === id)?.title ?? id);
  const base = { step: "plan_multi" as const, clarificationId: pending.id, rows: displayPoints(merged.points, request.locale), omitted };
  if (fetched.some((work) => work.result.partial)) return selectionResult(request, { ...base, status: "partial" });
  if (!merged.points.length) return selectionResult(request, { ...base, status: fetched.length < request.candidateIds.length ? "error" : "empty" });
  if (merged.points.length > 500) return selectionResult(request, { ...base, status: "too_large" });
  return routedMerge(request, pending, base, catalog, context);
}

async function routedMerge(request: Request, pending: Pending, base: { step: "plan_multi"; clarificationId: number; rows: Point[]; omitted: string[] }, catalog: ReturnType<typeof createCatalogClient>, context: Context) {
  try {
    const itinerary = await planSelectedPoints(catalog, base.rows, null, request.locale, context);
    const candidate = request.candidateIds.length === 1 ? pending.candidates.find((item) => item.id === request.candidateIds[0]) : undefined;
    return selectionResult(request, { ...base, status: itinerary.point_count ? "ok" : "error", ...(itinerary.point_count ? { itinerary } : {}),
      currentAnime: candidate ? { bangumiId: candidate.id, title: candidate.title } : null });
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error;
    return selectionResult(request, { ...base, status: error.code === "ROUTE_TOO_MANY_CLUSTERS" || error.code === "ROUTE_TOO_MANY_POINTS" ? "too_large" : "error" });
  }
}
