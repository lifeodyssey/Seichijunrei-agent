import type { QueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { RouteDetailView } from "../../features/route-detail/components/RouteDetailView";
import { RouteDetailErrorState, RouteDetailPendingState } from "../../features/route-detail/components/RouteDetailStates";
import { listSavedRoutesOptions } from "../../features/route-detail/hooks";
import { useDayClock, useRouteDetail } from "../../features/route-detail/hooks";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "../../i18n/locales";

/** A real `Error` carrying TanStack's not-found marker (`isNotFound: true`). */
function notFoundError(): Error {
  return Object.assign(new Error("unknown route id"), notFound());
}

function parseSearch(search: Record<string, unknown>): { readonly hl?: Locale } {
  const hl = search.hl;
  if (typeof hl === "string" && (LOCALES as readonly string[]).includes(hl)) return { hl: hl as Locale };
  return {};
}

async function assertRouteExists(queryClient: QueryClient, routeId: string): Promise<void> {
  const { saved_routes } = await queryClient.ensureQueryData(listSavedRoutesOptions());
  if (!saved_routes.some((route) => route.id === routeId)) throw notFoundError();
}

export const Route = createFileRoute("/routes/$routeId")({
  validateSearch: parseSearch,
  loaderDeps: ({ search }) => ({ hl: search.hl }),
  loader: async ({ params, deps, context }) => {
    await assertRouteExists(context.queryClient, params.routeId);
    // `now` is sampled in the loader, not at render: the serialized ISO string
    // keeps SSR HTML and client hydration agreeing on the same "today".
    return { locale: deps.hl ?? DEFAULT_LOCALE, now: new Date().toISOString() };
  },
  errorComponent: RouteDetailErrorState,
  pendingComponent: RouteDetailPendingState,
  component: RouteDetailRoute,
});

function RouteDetailRoute() {
  const { locale, now } = Route.useLoaderData();
  const { routeId } = Route.useParams();
  const detail = useRouteDetail(routeId);
  const dayNow = useDayClock(now);
  return <RouteDetailView detail={detail} locale={locale} now={dayNow} />;
}
