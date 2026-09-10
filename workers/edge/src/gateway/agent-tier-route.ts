/// <reference types="@cloudflare/workers-types" />

/**
 * The identity ladder in front of this Worker's own agent tier (W1-7 #1256).
 *
 * It is the same ladder the container forward has climbed since AUTH-2 #950 — a
 * verified Neon bearer first, else the anonymous pipeline (Turnstile → limiter →
 * budget latch), else a flat 401 — and that is the point of reusing it rather
 * than reimplementing it beside the tier: moving a route onto the new tier must
 * not move it out from behind a wall. Nothing below re-verifies anything; the
 * identity resolved here is the one the intake commits.
 *
 * ONE DELIBERATE WIDENING, and it is the card's whole reason to exist. Both
 * routes reach the anonymous pipeline here, where the container path gates it on
 * `isAnonymousV1` and `ANON_V1_PATHS` lists only `/v1/chat` — so today an
 * anonymous `GET /v1/conversations/{id}/messages` is a 401. W1's exit criterion
 * is "staging 匿名可完整对话；切走再回来拉到完整结果" (spec §五), which is precisely a
 * visitor with no account reading their own transcript back, so under `edge`
 * that GET must be reachable anonymously or the wave has no exit.
 *
 * What makes it safe is not the route table but `ConversationRetrieval`'s
 * ownership check: the page is returned only when `sessions.user_id` equals the
 * caller's identity, and an anonymous identity is an HMAC of a cookie
 * (`identity/anonymous-id.ts`), so knowing a conversation id buys nothing.
 * Missing and forbidden collapse to the same 404.
 *
 * `ANON_V1_PATHS` is deliberately NOT extended to carry this: that table drives
 * the CONTAINER path, and the flag's contract is that `container` stays byte for
 * byte what it is today. The widening lives on this side of the switch, and
 * `test/agent-turn-routing.test.ts` pins both positions of it.
 *
 * It lives beside `request.ts` instead of inside it because that file is the
 * whole-Worker dispatcher and is already at its size budget, and because these
 * three functions change for exactly one reason — how a turn reaches the agent
 * tier — which is not the dispatcher's reason to change.
 */
import type { Env, WorkerExecutionContext } from "../env.ts";
import type { AuthResult } from "../identity/auth.ts";
import { handleAnonymousV1 } from "../identity/anonymous-flow.ts";
import type { TurnstileGate } from "../protect/turnstile.ts";
import { authenticatedRateLimitKey, authRateLimitConfigFrom } from "../protect/rate-limiter.ts";
import { guardPolicy } from "../protect/burst-guard.ts";
import { classifyRatePolicy } from "./rate-policy.ts";
import { credentialsRequired, unauthorized } from "./responses.ts";
import type { EdgeTierRoute } from "./routing-policy.ts";
import type { AgentTurnTier, TurnIdentity } from "./agent-turn.ts";

/** What serving the agent tier needs from the gateway's composed gates — the
 * subset of `GatewayDeps`, which extends this rather than restating it. */
export interface AgentTierGates {
  authenticate: (request: Request, env: Env, ctx: WorkerExecutionContext) => Promise<AuthResult>;
  turnstileGate: TurnstileGate;
  sleep: (ms: number) => Promise<void>;
  /** This Worker's native agent tier. Tests may supply the gateway boundary
   * without constructing a database or Durable Object. */
  agentTurns: AgentTurnTier;
}

/** One route of the agent tier, served for one already-verified identity. */
function servedByTier(
  env: Env, request: Request, identity: TurnIdentity, route: EdgeTierRoute, gates: AgentTierGates,
): Promise<Response> {
  if (route.kind === "turn") return gates.agentTurns.chat(env, request, identity);
  if (route.kind === "probe") return gates.agentTurns.probe(request, identity);
  if (route.kind === "stream") return gates.agentTurns.stream(env, request, identity, route.sessionId);
  return gates.agentTurns.transcript(env, request, identity, route.sessionId);
}

/** The authenticated limiter still runs first: moving a turn onto this tier
 * must not be a way to stop metering it (`#680` AC4 — a high-cost write that
 * cannot be metered does not run). */
async function authenticatedTierResponse(
  env: Env, request: Request, auth: { userId: string; userType: string }, pathname: string,
  route: EdgeTierRoute, gates: AgentTierGates,
): Promise<Response> {
  const guarded = await guardPolicy(
    env, classifyRatePolicy(request.method, pathname), authenticatedRateLimitKey(auth.userId), authRateLimitConfigFrom(env),
  );
  const identity = { userId: auth.userId, userType: auth.userType };
  return guarded ?? servedByTier(env, request, identity, route, gates);
}

/**
 * Serve one agent-tier route to whichever identity the ladder resolves.
 *
 * `/v1/byok/probe` never reaches the anonymous pipeline (#1289). It is absent
 * from `ANON_V1_PATHS`, so the CONTAINER position answers an unauthenticated
 * probe with a flat 401 (`test/byok-probe-auth.test.ts`), and the flag's
 * contract is that moving a route onto this tier does not move it out from
 * behind a wall. The deliberate widening above is the transcript READ and only
 * that; spending a caller's key is the opposite of a cost-free read.
 */
export async function agentTierResponse(
  env: Env, request: Request, ctx: WorkerExecutionContext, pathname: string,
  route: EdgeTierRoute, gates: AgentTierGates,
): Promise<Response> {
  const auth = await gates.authenticate(request, env, ctx);
  if (auth.ok) return authenticatedTierResponse(env, request, auth, pathname, route, gates);
  if (auth.reason === "invalid") return unauthorized(pathname);
  if (route.kind === "probe") return credentialsRequired();
  const anonymous = await handleAnonymousV1(
    env, request, Date.now(), gates.turnstileGate, gates.sleep,
    (identity) => servedByTier(env, request, { userId: identity.userId, userType: "anonymous" }, route, gates),
  );
  return anonymous ?? credentialsRequired();
}
