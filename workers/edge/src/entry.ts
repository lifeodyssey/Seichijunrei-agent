// Composition root and the Worker's `main` (`workers/edge/wrangler.toml`); all
// logic lives in agent/ identity/ gateway/ protect/ proxy/ container/.
import { Container } from "@cloudflare/containers";
import { createWorkerApp } from "./app.ts";
import type { Env } from "./env.ts";
import { catalogOutbound } from "./gateway/forward.ts";
import {
  buildContainerEnvVars,
  DENIED_EGRESS_HOSTS,
  resolveContainerEnvVars,
} from "./container/container-env.ts";
import { withPortReadyBudget } from "./container/port-ready-budget.ts";

export { EdgeGuard } from "./protect/edge-guard.ts";
export { SessionAgent as AgentSession } from "./agent/host/session-agent.ts";
// Required for `deniedHosts`/outbound interception to actually run (#284 Task 7,
// PR #478 review): `applyOutboundInterception` hard-throws when
// `ctx.exports.ContainerProxy` is undefined — see
// `docs/ops/cloudflare-hardening.md` §6, "What is implemented", for the exact
// throw site and why this export, not a kernel filter, is what enforces the
// denylist.
export { ContainerProxy } from "@cloudflare/containers";

// Container-level egress URL-hostname denylist (#284 Task 7). `deniedHosts` is
// a plain string/glob matcher against the request URL's hostname (NOT CIDR —
// see `container-env.ts`'s header comment for the correction and why), enforced
// by the platform's Container runtime *before* any outbound handler runs, and
// unconditionally — even though `enableInternet` stays `true` (required:
// asyncpg's direct Postgres hop and the catalog.internal binding are
// non-HTTP/private-hostname traffic that must keep working). This is
// declarative platform config, not NET_ADMIN/iptables (confirmed unavailable on
// Cloudflare Containers — see docs/ops/cloudflare-hardening.md §6): it blocks
// plain-HTTP requests whose URL hostname is a denied literal/glob (the exact
// shape of the T3/T12 threat — cloud-metadata IMDS endpoints are typically
// requested by IP literal over plain HTTP) without requiring `interceptHttps`
// (which would additionally require the container to trust the platform's
// ephemeral MITM CA — a real cost, deferred; see the doc for the reasoning).
// It does NOT cover DNS rebinding (a hostname that only *resolves* to a denied
// address) — that remains the application-layer guard's job.
export class RuntimeContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  enableInternet = true;
  deniedHosts = DENIED_EGRESS_HOSTS;
  // Pinned, not changed: @cloudflare/containers@0.3.7's own default
  // (DEFAULT_SLEEP_AFTER in dist/lib/container.js) is also "10m" — an
  // unset `sleepAfter` was already this value. Issue #1220 makes it an
  // explicit, test-pinned contract instead of a library default this class
  // could silently drift away from on an upgrade.
  sleepAfter = "10m";
  readonly #workerEnv: Record<string, unknown>;
  #envResolved = false;
  constructor(ctx: DurableObjectState<object>, env: Record<string, unknown>) {
    super(ctx, env);
    this.#workerEnv = env;
    this.envVars = buildContainerEnvVars(env);
  }
  async #hydrateStoreSecrets(): Promise<void> {
    if (this.#envResolved) return;
    this.envVars = await resolveContainerEnvVars(this.#workerEnv);
    this.#envResolved = true;
  }
  override async start(
    ...args: Parameters<Container["start"]>
  ): Promise<void> {
    await this.#hydrateStoreSecrets();
    return super.start(...args);
  }
  override async startAndWaitForPorts(
    ...args: Parameters<Container["startAndWaitForPorts"]>
  ): Promise<void> {
    await this.#hydrateStoreSecrets();
    return super.startAndWaitForPorts(...withPortReadyBudget(args));
  }
}

// Container -> catalog over a private hostname, intercepted here and routed to
// the CATALOG service binding (no public internet). Host matches CATALOG_API_URL.
//
// Deny-by-default: with enableInternet = true and no catch-all in outboundByHost,
// every container outbound EXCEPT catalog.internal goes to the public internet by
// design (the agent calls Anitabi, Bangumi, and LLM APIs directly). Catalog's
// privacy rests entirely on this exact host match — any FUTURE internal-only
// service MUST be added to outboundByHost explicitly; it will NOT be private
// otherwise.
RuntimeContainer.outboundByHost = {
  "catalog.internal": (request: Request, env: Env) => catalogOutbound(request, env),
};

export default createWorkerApp({});
