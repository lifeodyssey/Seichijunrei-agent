import type { JWTVerifyGetKey } from "jose";
import { Hono, type Context } from "hono";
import {
  type GitHubOidcVerifier,
} from "@animichi/contract/oidc-github";
import { productionChain } from "./bundled-chain";
import { headsOf, type ChainSource } from "./chain";
import { NeonMigrationsLedger } from "./ledger";
import { runMigration, type ContainerOutcome, type MigrationRunResult } from "./migration";
import { authenticateRequest } from "./request-auth";
import { registerPreflight } from "./preflight";
import { resolveDsn } from "./database-url";

/**
 * #1051 / #1124 — the migrator's Hono application + environment, kept free of
 * @cloudflare/containers so HTTP-seam tests run under plain vitest. Default
 * apply is neon-http (lazy lock + chain); tests inject `runContainer`.
 */

/** Migrator Worker bindings (Secrets Store DSN + apply-lock DO + container). */
export interface Env {
  ENVIRONMENT?: string;
  MIGRATOR_DATABASE_URL?: string | SecretsStoreSecret;
  MIGRATOR_CONTAINER: DurableObjectNamespace;
  /** Fixed-name mutex for HTTP apply. Required on the production default path. */
  MIGRATOR_APPLY_LOCK?: DurableObjectNamespace;
  /** Optional per-deploy cap on the one-shot container run, in ms. */
  CONTAINER_TIMEOUT_MS?: string;
  /** Selects the OIDC claims allowlist; only "production" opens that door. */
  MIGRATOR_OIDC_POLICY?: string;
}

/** Injectable boundaries used by the worker HTTP-seam tests. */
export interface MigratorDeps {
  verifier?: GitHubOidcVerifier;
  /** JWKS for the env-selected policy; `verifier` overrides the selection. */
  jwks?: JWTVerifyGetKey;
  runContainer?: (dsn: string, expectedHead?: string) => Promise<ContainerOutcome>;
  readAppliedHead?: (dsn: string) => Promise<string | null>;
  /** The chain this Worker carries; the handshake answers from it. */
  chain?: ChainSource;
}

/**
 * #1365 / #1332 — `wrangler deploy` returning is not the new bundle serving.
 * The Worker publishes the chain it actually carries on `/healthz`, and
 * refuses a head that chain cannot reach before it touches the database.
 */
class BundleHandshake {
  private readonly heads: readonly string[];

  constructor(source: ChainSource) {
    this.heads = headsOf(source);
  }

  /** The last head of the carried chain — what a caller must wait for. */
  get head(): string | null {
    return this.heads[this.heads.length - 1] ?? null;
  }

  /** An expected head this bundle cannot reach means the caller is ahead of it. */
  stale(expectedHead: string | undefined): boolean {
    return expectedHead !== undefined && !this.heads.includes(expectedHead);
  }
}

function healthz(c: Context<{ Bindings: Env }>, bundle: BundleHandshake): Response {
  return c.json({
    status: "ok",
    service: "migrator",
    env: c.env.ENVIRONMENT ?? "unknown",
    bundleHead: bundle.head,
  });
}

/** JSON.parse returns `any`; narrow to `unknown` at the only parse site. */
function parseJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

type ParsedBody = { ok: true; expectedHead: string | undefined } | { ok: false };

function expectedHeadOf(parsed: object): string | undefined {
  if (!("expectedHead" in parsed)) return undefined;
  return typeof parsed.expectedHead === "string" ? parsed.expectedHead : undefined;
}

/** Parse the optional JSON body into an object; a non-object body is a 400. */
async function parseBody(request: Request): Promise<ParsedBody> {
  try {
    const raw = await request.text();
    const parsed = parseJson(raw.length === 0 ? "{}" : raw);
    if (typeof parsed !== "object" || parsed === null) return { ok: false };
    return { ok: true, expectedHead: expectedHeadOf(parsed) };
  } catch {
    return { ok: false };
  }
}

function timeoutResponse(result: Extract<MigrationRunResult, { kind: "timeout" }>): Response {
  const body =
    result.exitCode === undefined
      ? { success: false, error: "timeout", ranMs: result.ranMs, lastStatus: result.lastStatus }
      : { success: false, error: "timeout", ranMs: result.ranMs, lastStatus: result.lastStatus, exitCode: result.exitCode };
  return Response.json(body, { status: 504 });
}

function headLabel(head: string | null): string {
  return head ?? "null";
}

function mismatchResponse(result: Extract<MigrationRunResult, { kind: "head_mismatch" }>): Response {
  const error = `applied head ${headLabel(result.appliedHead)} does not equal expected head ${headLabel(result.expectedHead)}`;
  return Response.json(
    { success: false, exitCode: 1, appliedHead: result.appliedHead, error },
    { status: 500 },
  );
}

function successResponse(result: Extract<MigrationRunResult, { kind: "success" }>): Response {
  return Response.json({
    success: true,
    exitCode: 0,
    appliedHead: result.appliedHead,
    pathVerification: result.pathVerification,
  });
}

interface FailureJson {
  success: false;
  exitCode: number;
  appliedHead: null;
  error?: string;
}

function failureBody(result: Extract<MigrationRunResult, { kind: "failure" }>): FailureJson {
  if (result.error === undefined) {
    return { success: false, exitCode: result.exitCode, appliedHead: null };
  }
  return { success: false, exitCode: result.exitCode, appliedHead: null, error: result.error };
}

/**
 * 422, not 409: the 409 of this API is `stale_bundle`, which the deploy script
 * answers by waiting and re-POSTing (scripts/delivery/migrate-through-worker.sh).
 * A request this bundle and ledger cannot satisfy never becomes satisfiable by
 * waiting, so it must not land in that retry loop.
 */
function refusedResponse(result: Extract<MigrationRunResult, { kind: "refused" }>): Response {
  return Response.json({ success: false, appliedHead: null, error: result.reason }, { status: 422 });
}

function outcomeResponse(result: MigrationRunResult): Response {
  if (result.kind === "failure") return Response.json(failureBody(result), { status: 500 });
  if (result.kind === "refused") return refusedResponse(result);
  if (result.kind === "timeout") return timeoutResponse(result);
  if (result.kind === "head_mismatch") return mismatchResponse(result);
  return successResponse(result);
}

/**
 * The bounded apply seam: the head the caller asked for travels with the DSN.
 * A revived container path must forward it too — `ContainerRunner.start(dsn,
 * timeoutMs)` (src/runner.ts) type-checks while dropping the head, and an apply
 * that never sees it is unbounded again.
 */
type MigrationApply = (dsn: string, expectedHead?: string) => Promise<ContainerOutcome>;

async function runContainerFor(
  env: Env,
  deps: MigratorDeps,
): Promise<MigrationApply> {
  if (deps.runContainer !== undefined) return deps.runContainer;
  const { productionApply } = await import("./lock");
  return httpApplyBound(env, productionApply);
}

function httpApplyBound(
  env: Env,
  bind: (ns: DurableObjectNamespace) => MigrationApply,
): MigrationApply {
  if (env.MIGRATOR_APPLY_LOCK === undefined) throw new Error("migrator apply lock not configured");
  return bind(env.MIGRATOR_APPLY_LOCK);
}

type Guarded =
  | { ok: true; expectedHead: string | undefined }
  | { ok: false; response: Response };

/** Identity, then body shape, then the bundle handshake — all before any DSN. */
async function guardRequest(
  c: Context<{ Bindings: Env }>,
  deps: MigratorDeps,
  bundle: BundleHandshake,
): Promise<Guarded> {
  const verified = await authenticateRequest(c.req.raw, c.env.MIGRATOR_OIDC_POLICY, deps);
  if (verified === null) return { ok: false, response: c.json({ error: "unauthorized" }, 401) };
  if (!verified.ok) {
    return { ok: false, response: c.json({ error: "forbidden", message: verified.reason }, 403) };
  }
  const body = await parseBody(c.req.raw);
  if (!body.ok) return { ok: false, response: c.json({ error: "invalid request body" }, 400) };
  if (bundle.stale(body.expectedHead)) {
    return { ok: false, response: c.json({ error: "stale_bundle", bundleHead: bundle.head }, 409) };
  }
  return { ok: true, expectedHead: body.expectedHead };
}

async function handleMigrate(
  c: Context<{ Bindings: Env }>,
  deps: MigratorDeps,
  bundle: BundleHandshake,
): Promise<Response> {
  const guard = await guardRequest(c, deps, bundle);
  if (!guard.ok) return guard.response;
  const dsn = await resolveDsn(c.env);
  if (dsn === undefined) return c.json({ error: "migrator database not configured" }, 503);
  try {
    const runContainer = await runContainerFor(c.env, deps);
    const readAppliedHead = deps.readAppliedHead ??
      ((value: string) => new NeonMigrationsLedger().readAppliedHead(value));
    const result = await runMigration(dsn, { runContainer, readAppliedHead }, guard.expectedHead);
    return outcomeResponse(result);
  } catch (error) {
    // #1091 (US-27): an unexpected orchestration throw must be observable —
    // the bare Hono 500 hid the failure reason on the first real trigger run.
    // Surface the exception message only (never a DSN or credential).
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
}

/** Create an independently injectable migrator Hono application. */
export function createMigratorApp(deps: MigratorDeps = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const bundle = new BundleHandshake(deps.chain ?? productionChain);
  app.get("/healthz", (c) => healthz(c, bundle));
  app.post("/migrate", (c) => handleMigrate(c, deps, bundle));
  registerPreflight(app, deps);
  return app;
}
