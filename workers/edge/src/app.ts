// Hono assembly only: it wires the concern folders together and holds no logic
// of its own.
import { Hono } from "hono";
import type { Env, WorkerExecutionContext } from "./env.ts";
import type { AuthResult } from "./identity/auth.ts";
import { authenticate as realAuthenticate } from "./identity/auth.ts";
import { HandleGatewayRequest, gatewayFailure, type GatewayDeps } from "./gateway/request.ts";
import { createTurnstileGate, type TurnstileGate } from "./protect/turnstile.ts";
import { createShowcaseMode, type ShowcaseMode } from "./proxy/showcase.ts";
import { neonAgentTurnTier, type AgentTurnTier } from "./gateway/agent-turn.ts";

/** The main Worker app: a pure API and asset gateway. Every request —
 * `/healthz`, the image and private R2 tile proxies, the one allowlisted
 * public catalog read, and the whole `/v1` surface — is delegated to the
 * composed gateway seam (HandleGatewayRequest), which owns route selection,
 * identity, protection, internal-identity construction, and forwarding.
 *
 * Issue #537 removed the OpenNext catch-all that used to render the legacy
 * Next.js homepage here; `apps/web` owns every HTML surface now. Unmatched
 * paths answer `notFoundResponse()` instead of a page — see its comment for why
 * that is a hard 404 and not a friendly 200. */

type WorkerApp = Hono<{ Bindings: Env }>;

export interface WorkerDeps {
  authenticate?: (request: Request, env: Env, ctx: WorkerExecutionContext) => Promise<AuthResult>;
  turnstileGate?: TurnstileGate;
  /** Injectable sleep for the container cold-start retry (tests avoid real waits). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable showcase gate (tests capture its warning / isolate it per case). */
  showcaseMode?: ShowcaseMode;
  /** Injectable agent tier (W1-7 #1256): the production one opens a Neon pool
   * and two Durable Object stubs, so tests substitute it to stay hermetic. */
  agentTurns?: AgentTurnTier;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveGates(deps: WorkerDeps): GatewayDeps {
  // One gate per app instance, built outside the request handlers so their
  // pass window / warn-once dedupe is shared by every request on the same
  // isolate — tests inject their own to keep state out of module scope.
  return {
    authenticate: deps.authenticate ?? ((req, env, ctx) => realAuthenticate(req, env, fetch, ctx)),
    turnstileGate: deps.turnstileGate ?? createTurnstileGate(),
    showcaseMode: deps.showcaseMode ?? createShowcaseMode(),
    sleep: deps.sleep ?? realSleep,
    agentTurns: deps.agentTurns ?? neonAgentTurnTier(),
  };
}

export function createWorkerApp(deps: WorkerDeps): WorkerApp {
  const app = new Hono<{ Bindings: Env }>();
  const gates = resolveGates(deps);
  app.all("*", (c) => HandleGatewayRequest(c.env, c.req.raw, c.executionCtx, gates));
  // EG-06: without this an unexpected throw is Hono's plain-text 500, outside
  // every envelope and outside the request record.
  app.onError((error, c) => gatewayFailure(error, c.req.raw));
  return app;
}
