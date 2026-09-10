/// <reference types="@cloudflare/workers-types" />
// The Worker's binding/context types, imported by every concern folder.
import type { SessionAgent } from "./agent/host/session-agent.ts";
import type { GuardNamespace } from "./protect/guard-store.ts";
import type { TileBucket } from "./proxy/tiles.ts";

export interface Env {
  CATALOG: { fetch: (req: Request) => Promise<Response> };
  USERS: { fetch: (req: Request) => Promise<Response> };
  CONTAINER: DurableObjectNamespace;
  EDGE_GUARD: GuardNamespace;
  MAP_TILES?: TileBucket;
  /** Neon Auth branch JWKS URL — the edge's only identity source (AUTH-2 #950).
   * Empty/absent fails closed: no JWKS, no verified bearer. */
  NEON_AUTH_JWKS_URL?: string;
  /** Native account secret binding; local development uses .dev.vars strings. */
  TURNSTILE_SECRET: SecretsStoreSecret | string;
  ANON_ACCESS_ENABLED?: string;
  ANON_ID_SECRET?: SecretsStoreSecret | string;
  /** Showcase-mode gate (S0-v2 GOAL C / C9): strict boolean, worker-side
   * sibling of the web app's VITE_SHOWCASE_MODE. Only the literal "false"
   * opens functional routes; unset/empty/malformed values fail closed (deny). */
  EDGE_SHOWCASE_MODE?: string;
  /** Native per-session host; production configurations bind it. */
  AGENT_SESSION?: DurableObjectNamespace<SessionAgent>;
  /** Deployment identity for environment-specific product capabilities. */
  APP_ENV?: string;
  /** Per-identity anonymous message reservation ceiling; zero disables it. */
  ANON_DAILY_MESSAGE_QUOTA?: string;
  ANON_DAILY_COST_BUDGET_USD?: string;
  MIMO_API_KEY?: SecretsStoreSecret | string;
  /** The `agent_svc` Neon DSN. A Cloudflare Secrets Store binding where one is
   * declared (both environments, `docs/ops/secrets.md`), or a plain string
   * from local .dev.vars. */
  AGENT_SVC_DATABASE_URL?: SecretsStoreSecret | string;
  /** Cloudflare-native `ratelimit` binding (issue #680): the COARSE
   * best-effort burst damper. Absent (unit tests, a config without the
   * binding) is treated as an outage — coarseBurstAllow fails open + alerts. */
  RATE_LIMITER?: RateLimit;
  [key: string]: unknown;
}

export type WorkerExecutionContext = Pick<ExecutionContext, "waitUntil" | "passThroughOnException">;
