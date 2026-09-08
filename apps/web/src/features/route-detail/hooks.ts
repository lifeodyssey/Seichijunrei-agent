import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Itinerary, SavedRoute } from "@animichi/contract";
import { catalog, users } from "../../api/orpc";
import { projectRouteDetail, selectSavedRoute } from "./load-route-detail";
import type { RouteDetail } from "./lib/data-state";

/** Query options for the caller's saved routes, shared by the route-detail
 * loader (`ensureQueryData` prefetch + existence check on the server) and the
 * suspense hook (hydrated client read — no double fetch, wired by
 * `routerWithQueryClient`). */
export function listSavedRoutesOptions() {
  return users().listSavedRoutes.queryOptions();
}

/** Query options for planning the itinerary over a route's points. */
export function planItineraryOptions(pointIds: readonly string[]) {
  return catalog().planItinerary.queryOptions({ input: { point_ids: [...pointIds] } });
}

export function useSavedRoutes() {
  return useSuspenseQuery(listSavedRoutesOptions());
}

/** Suspense hook for one route's detail: owned list -> selection -> itinerary. */
export function useRouteDetail(routeId: string): RouteDetail {
  const { data } = useSavedRoutes();
  const route = selectSavedRoute(data.saved_routes, routeId);
  const { data: itinerary } = useSuspenseQuery(planItineraryOptions(route.point_ids));
  return projectRouteDetail(route, itinerary);
}

/** Live read port bound to the Users + Catalog clients (test seams use a fake). */
export const liveRouteDetailPort = {
  listOwned: async (): Promise<{ readonly saved_routes: readonly SavedRoute[] }> => users().listSavedRoutes.call(),
  planItinerary: async (pointIds: readonly string[]): Promise<Itinerary> => catalog().planItinerary.call({ point_ids: [...pointIds] }),
};

function msUntilNextLocalDay(from: Date): number {
  const midnight = new Date(from);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - from.getTime() + 1000;
}

/** The loader's `now`, re-sampled at each local midnight so a long-mounted
 * page flips its "today" state without waiting for loader revalidation. */
export function useDayClock(isoNow: string): Date {
  const [now, setNow] = useState(() => new Date(isoNow));
  useEffect(() => {
    const timer = setTimeout(() => { setNow(new Date()); }, msUntilNextLocalDay(now));
    return () => { clearTimeout(timer); };
  }, [now]);
  return now;
}
