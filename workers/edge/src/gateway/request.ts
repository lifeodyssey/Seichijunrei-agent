/// <reference types="@cloudflare/workers-types" />

import type { Env, WorkerExecutionContext } from "../env.ts";
import type { AuthResult } from "../identity/auth.ts";
import { handleAnonymousV1 } from "../identity/anonymous-flow.ts";
import { verifyAnonymousEntry } from "../identity/turnstile-entry.ts";
import { handleSessionAdopt } from "../identity/session-adopt.ts";
import { handleImageProxy } from "../proxy/image-proxy.ts";
import { handleTiles } from "../proxy/tiles.ts";
import type { ShowcaseMode } from "../proxy/showcase.ts";
import { TURNSTILE_VERIFY_PATH } from "@animichi/contract/constants";
import { authenticatedRateLimitKey, authRateLimitConfigFrom } from "../protect/rate-limiter.ts";
import { guardPolicy } from "../protect/burst-guard.ts";
import { authenticatedForward, forwardPublicCatalog, forwardUsers, forwardV1 } from "./forward.ts";
import { fetchContainerResilient } from "./container-fetch.ts";
import { classifyRatePolicy } from "./rate-policy.ts";
import { classify, isFunctionalRoute, type RequestClass } from "./request-class.ts";
import {
  credentialsRequired, gatewayRejection, internalError, methodNotAllowed, notFoundResponse, showcaseDenied, unauthorized,
} from "./responses.ts";
import { publicReadKey } from "./read-key.ts";
import { isAnonymousV1, isPublicV1, turnRoutePolicy } from "./routing-policy.ts";
import { agentTierResponse, type AgentTierGates } from "./agent-tier-route.ts";
import { stagingPrefixResponse, stagingPrefixRoute } from "./staging-prefix-route.ts";

// ── EDGE-1 #963: the composed gateway seam ─────────────────────────────────
//
// HandleGatewayRequest is the single request surface of the edge worker:
// route selection, the showcase gate, identity verification (Neon), the
// anonymous pipeline (mint → Turnstile → limiter → budget), the
// authenticated limiter, trusted internal-identity construction, and
// forwarding to Catalog / Users / the agent container run here, in that
// order. app.ts delegates to it once.

/** Structured, credential-free request record (EDGE-1 #963): identity kind
 * (class), upstream status and duration only — never a token, trusted
 * header, user identifier, path or payload. */
function observe(route: RequestClass, status: number, startedMs: number): void {
  console.warn(JSON.stringify({
    event: "edge_gateway_request",
    class: route.kind,
    status,
    duration_ms: Date.now() - startedMs,
  }));
}

/** Entry-side counterpart to `observe`, logged BEFORE dispatch: without it a
 * request whose response never lands (mid-flight cancel, a hung container)
 * leaves no trace at all. Route class + method only — pathnames carry
 * identifiers (`/v1/conversations/{session_id}`), so they stay out of logs. */
function observeEntry(route: RequestClass, request: Request): void {
  console.warn(JSON.stringify({
    event: "edge_gateway_request_start",
    class: route.kind,
    method: request.method,
  }));
}

type AuthFailure = Extract<AuthResult, { ok: false }>;

/** The shared credential-rejection branch: invalid logs the 401 storm
 * record; absent is a flat 401 with no record (issue #441). */
function authenticationRejection(request: Request, auth: AuthFailure): Response {
  const { pathname } = new URL(request.url);
  return auth.reason === "invalid" ? unauthorized(pathname) : credentialsRequired();
}

export interface GatewayDeps extends AgentTierGates {
  showcaseMode: ShowcaseMode;
}

export function HandleGatewayRequest(
  env: Env, request: Request, ctx: WorkerExecutionContext, deps: GatewayDeps,
): Promise<Response> {
  const route = classify(request);
  observeEntry(route, request);
  return observed(route, Date.now(), () => routedResponse(route, env, request, ctx, deps));
}

function routedResponse(
  route: RequestClass, env: Env, request: Request, ctx: WorkerExecutionContext, deps: GatewayDeps,
): Promise<Response> {
  if (isFunctionalRoute(route) && deps.showcaseMode.isEnabled(env.EDGE_SHOWCASE_MODE)) {
    return Promise.resolve(showcaseDenied());
  }
  return dispatch(route, env, request, ctx, deps);
}

/** Every request leaves a completion record, including one whose dispatch threw
 * (EG-06): a failure that is invisible in the request stream is the one failure
 * nobody can find. A throw is recorded as the status `gatewayFailure` will
 * answer with, then rethrown for `app.onError` to answer. */
async function observed(
  route: RequestClass, startedMs: number, dispatchRoute: () => Promise<Response>,
): Promise<Response> {
  let status = GATEWAY_FAILURE_STATUS;
  try {
    const response = await dispatchRoute();
    status = response.status;
    return response;
  } finally {
    observe(route, status, startedMs);
  }
}

const GATEWAY_FAILURE_STATUS = 500;

/** The Worker's last line (EG-06). Hono's default for an unhandled throw is a
 * plain-text 500 outside every envelope, so `app.onError` routes here instead:
 * one structured record — route class, status and the error's NAME, never its
 * message, which is a server-side string that may carry a DSN or a stack — and
 * the same rejection envelope as every deliberate refusal. */
export function gatewayFailure(error: unknown, request: Request): Response {
  console.warn(JSON.stringify({
    event: "edge_gateway_error",
    class: classify(request).kind,
    status: GATEWAY_FAILURE_STATUS,
    error: error instanceof Error ? error.name : "unknown",
  }));
  return internalError();
}

function dispatch(route: RequestClass, env: Env, request: Request, ctx: WorkerExecutionContext, deps: GatewayDeps): Promise<Response> {
  switch (route.kind) {
    case "landing": return landingResponse(env, request, ctx, route.asset, deps.sleep);
    case "public-catalog": return publicCatalogResponse(env, request);
    case "users": return usersResponse(env, request, ctx, deps);
    case "adopt": return adoptResponse(env, request, ctx, deps);
    case "v1": return agentV1Response(env, request, ctx, route.pathname, deps);
    case "retired": return Promise.resolve(notFoundResponse());
    case "not-found": return Promise.resolve(notFoundResponse());
  }
}

function landingResponse(
  env: Env, request: Request, ctx: WorkerExecutionContext, asset: "healthz" | "banner" | "tiles" | "img", sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  if (asset === "healthz" || asset === "banner") return containerLanding(env, request, sleep);
  if (asset === "tiles") return handleTiles(request, env.MAP_TILES, ctx);
  return handleImageProxy(request, ctx);
}

/** The two landing surfaces the container serves — `GET /healthz` (the CD
 * smoke's readiness probe, which must keep answering the container's own
 * `{"status":"ok"}` verbatim) and `GET /` (its JSON service banner).
 *
 * Both ride the same bounded fetch as `/v1` (EG-21, issue #1343). They used to
 * be the exception: the probe had the cold-start retry but no head timeout and
 * the banner had neither, so a hung container left the Worker request running
 * long after the smoke's own `--max-time 15` had given up. Nothing argued that
 * exemption — the head-timeout comment in `container-fetch.ts` argues the
 * `/v1` bound — and the banner gains the retry for the same reason the probe
 * has it: the request that wakes a cold container should not be the one that
 * fails. */
function containerLanding(env: Env, request: Request, sleep: (ms: number) => Promise<void>): Promise<Response> {
  const container = env.CONTAINER.get(env.CONTAINER.idFromName("default"));
  return fetchContainerResilient((inner) => container.fetch(inner), request, sleep);
}

async function publicCatalogResponse(env: Env, request: Request): Promise<Response> {
  if (new URL(request.url).search) return gatewayRejection("unexpected_query", 400, "This route takes no query parameters.");
  const guarded = await guardPolicy(env, classifyRatePolicy(request.method, new URL(request.url).pathname), publicReadKey(request), authRateLimitConfigFrom(env));
  if (guarded !== null) return guarded;
  return forwardPublicCatalog(env, request);
}

async function usersResponse(
  env: Env, request: Request, ctx: WorkerExecutionContext, deps: GatewayDeps,
): Promise<Response> {
  const auth = await deps.authenticate(request, env, ctx);
  if (!auth.ok) return authenticationRejection(request, auth);
  // User-account mutations (POST/DELETE) are an exact durable fail-closed
  // write class (AC2/AC4) per the route policy; GET reads classify unmanaged
  // and are never metered. One decision path: classify then `guardPolicy`.
  const guarded = await guardPolicy(
    env,
    classifyRatePolicy(request.method, new URL(request.url).pathname),
    authenticatedRateLimitKey(auth.userId),
    authRateLimitConfigFrom(env),
  );
  if (guarded !== null) return guarded;
  return forwardUsers(env, request, auth);
}

async function adoptResponse(
  env: Env, request: Request, ctx: WorkerExecutionContext, deps: GatewayDeps,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const auth = await deps.authenticate(request, env, ctx);
  if (!auth.ok) return authenticationRejection(request, auth);
  // Adoption is a state-migrating WRITE: the route policy classifies it as a
  // durable fail-closed mutation, so it rides the same `guardPolicy` seam.
  const guarded = await guardPolicy(
    env,
    classifyRatePolicy(request.method, new URL(request.url).pathname),
    authenticatedRateLimitKey(auth.userId),
    authRateLimitConfigFrom(env),
  );
  if (guarded !== null) return guarded;
  return handleSessionAdopt(env, request, auth, deps.sleep);
}

async function agentV1Response(
  env: Env, request: Request, ctx: WorkerExecutionContext, pathname: string, deps: GatewayDeps,
): Promise<Response> {
  if (pathname === TURNSTILE_VERIFY_PATH) return turnstileVerifyResponse(env, request, ctx, deps);
  // W1-7 #1256: the fallback flag is read here and nowhere else. It selects at
  // most the two agent-turn routes; everything else under /v1 — and every route
  // at all while the flag says `container` — takes the branches below unchanged.
  const edgeTier = turnRoutePolicy(env.AGENT_TURN_ROUTE).select(request.method, pathname);
  if (edgeTier !== null) return agentTierResponse(env, request, ctx, pathname, edgeTier, deps);
  // E-1 #1380: the eval's frozen-prefix seeding, mounted only where
  // `APP_ENV === "staging"`. Read here, beside the flag above, because this is
  // the one place `/v1` dispatch is decided; on every other deployment the
  // policy answers null and the request takes the branches below unchanged —
  // which is a container that has never served this path, i.e. a 404.
  const seeding = stagingPrefixRoute(env.APP_ENV, request.method, pathname);
  if (seeding !== null) return stagingPrefixResponse(env, request, ctx, seeding, deps);
  if (isPublicV1(pathname)) return publicAgentV1Response(env, request, pathname, deps.sleep);
  return privateAgentV1Response(env, request, ctx, pathname, deps);
}

async function publicAgentV1Response(
  env: Env, request: Request, pathname: string, sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  const policy = classifyRatePolicy(request.method, pathname);
  const guarded = await guardPolicy(env, policy, publicReadKey(request), authRateLimitConfigFrom(env));
  return guarded ?? forwardV1(env, request, undefined, undefined, sleep);
}

async function privateAgentV1Response(
  env: Env, request: Request, ctx: WorkerExecutionContext, pathname: string, deps: GatewayDeps,
): Promise<Response> {
  const auth = await deps.authenticate(request, env, ctx);
  if (auth.ok) return authenticatedForward(env, request, auth, pathname, deps.sleep);
  if (auth.reason === "invalid") return unauthorized(pathname);
  const anonymous = await anonymousAgentResponse(env, request, pathname, deps);
  if (anonymous !== null) return anonymous;
  return credentialsRequired();
}

async function anonymousAgentResponse(
  env: Env, request: Request, pathname: string, deps: GatewayDeps,
): Promise<Response | null> {
  if (!isAnonymousV1(pathname)) return null;
  return handleAnonymousV1(env, request, Date.now(), deps.turnstileGate, deps.sleep);
}

async function turnstileVerifyResponse(
  env: Env, request: Request, ctx: WorkerExecutionContext, deps: GatewayDeps,
): Promise<Response> {
  if (request.method !== "POST") return Promise.resolve(methodNotAllowed());
  const auth = await deps.authenticate(request, env, ctx);
  if (auth.ok) return new Response(null, { status: 204 });
  if (auth.reason === "invalid") return authenticationRejection(request, auth);
  return verifyAnonymousEntry(env, request, deps.turnstileGate);
}
