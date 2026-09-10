import { http, HttpResponse } from "msw";
import { SearchInput, SearchResult } from "@animichi/contract";
import { catalogPlanItineraryHandler } from "./catalog-itinerary";
import { contractJsonHandler, orpcErrorResponse } from "./contract-handler";
import { CATALOG_SEARCH_URL, searchSuccessFixture } from "./fixtures";

/** Query sentinel that forces the catalog to report an upstream outage. */
export const UPSTREAM_QUERY = "__upstream__";

/**
 * Default catalog.search handler: success for a normal query, a typed
 * `UPSTREAM_UNAVAILABLE` oRPC error for the {@link UPSTREAM_QUERY} sentinel.
 */
export const catalogSearchHandler = contractJsonHandler({
  method: "post",
  url: CATALOG_SEARCH_URL,
  input: SearchInput,
  output: SearchResult,
  resolve: (input) =>
    input.query === UPSTREAM_QUERY
      ? { code: "UPSTREAM_UNAVAILABLE", status: 502, message: "Upstream catalog source unavailable", data: { upstream: "anitabi" } }
      : searchSuccessFixture,
});

/** A handler that always fails with the upstream error, for typed-error tests. */
export const catalogUpstreamErrorHandler = contractJsonHandler({
  method: "post",
  url: CATALOG_SEARCH_URL,
  input: SearchInput,
  output: SearchResult,
  resolve: () => ({
    code: "UPSTREAM_UNAVAILABLE",
    status: 502,
    message: "Upstream catalog source unavailable",
    data: { upstream: "anitabi" },
  }),
});

/**
 * Default session-adoption handler (#507). Every login now posts here, so the
 * unit lane needs it to stay hermetic — `{"adopted": 0}` is the endpoint's
 * own typed no-op for a caller with no anonymous history, which is exactly
 * what a test-tab login is.
 */
export const sessionAdoptHandler = http.post(
  "*/v1/sessions/adopt",
  () => HttpResponse.json({ adopted: 0, noop_class: "no_rows" }),
);

/** Existing UI-only fixtures contain no active native operation unless a test supplies its stream. */
const idleNativeStream = http.get("*/v1/conversations/:sessionId/stream", () => new HttpResponse(null, { status: 204 }));

export const handlers = [catalogSearchHandler, catalogPlanItineraryHandler, sessionAdoptHandler, idleNativeStream];

export { orpcErrorResponse };
