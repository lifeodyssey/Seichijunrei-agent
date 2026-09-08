import { USERS_BINDING_PREFIX } from "@animichi/contract/internal-binding";
import { SESSION_ADOPT_PATH } from "../identity/session-adopt.ts";

/**
 * WHICH surface a request is for (EDGE-1 #963), as one pure decision taken once
 * per request. Split out of `gateway/request.ts` when the failure paths landed
 * (EG-06, issue #1343): the class is now read by the dispatch, by the request
 * record on both its entry and completion sides, and by the error record — and
 * the seam that composes those is long enough without it.
 *
 * Reads no binding and takes no dependency on how a class is SERVED, which is
 * what keeps `app.onError` able to name the class of a request that threw.
 */

/** The legacy anonymous-session migration path deleted with AdoptSessions
 * (SESSION-2 #960). Explicitly rejected here so no branch can ever forward a
 * request to a route that no longer exists. */
const SESSION_MIGRATE_PATH = "/v1/session/migrate";

/** The one allowlisted public catalog read (issue #537 / CATALOG-5 #946). */
const PUBLIC_CATALOG_PATTERN = /^\/catalog\/public\/anime-overview\/\d+$/;

const USERS_PREFIX = USERS_BINDING_PREFIX;

export type RequestClass =
  | { kind: "landing"; asset: "healthz" | "banner" | "tiles" | "img" }
  | { kind: "public-catalog" }
  | { kind: "users" }
  | { kind: "adopt" }
  | { kind: "v1"; pathname: string }
  | { kind: "retired" }
  | { kind: "not-found" };

/** The landing surface, which the showcase gate never denies. */
function landingClass(method: string, pathname: string): RequestClass | null {
  if (pathname === "/healthz" && method === "GET") return { kind: "landing", asset: "healthz" };
  // The agent's JSON service banner at the root (CONTRACT-1 #938). Not an HTML
  // page — #537 retired the page renderer, not the container's root JSON — so
  // forwarding it to the container keeps every advertised Agent operation
  // reachable through the CONTAINER binding (#1005 AC1).
  if (pathname === "/" && method === "GET") return { kind: "landing", asset: "banner" };
  if (pathname.startsWith("/tiles/")) return { kind: "landing", asset: "tiles" };
  if (pathname.startsWith("/img/")) return { kind: "landing", asset: "img" };
  return null;
}

/** Pure route selection: one classification per request, no bindings read. */
export function classify(request: Request): RequestClass {
  const { pathname } = new URL(request.url);
  const landing = landingClass(request.method, pathname);
  if (landing !== null) return landing;
  if (request.method === "GET" && PUBLIC_CATALOG_PATTERN.test(pathname)) return { kind: "public-catalog" };
  if (pathname === SESSION_MIGRATE_PATH) return { kind: "retired" };
  if (pathname.startsWith(USERS_PREFIX)) return { kind: "users" };
  if (pathname === SESSION_ADOPT_PATH) return { kind: "adopt" };
  if (pathname.startsWith("/v1/")) return { kind: "v1", pathname };
  return { kind: "not-found" };
}

/** Functional routes are denied in showcase mode; the landing surface stays. */
export function isFunctionalRoute(route: RequestClass): boolean {
  return route.kind !== "landing" && route.kind !== "not-found";
}
