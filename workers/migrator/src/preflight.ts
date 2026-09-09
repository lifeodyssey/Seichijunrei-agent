import { NeonDbError } from "@neondatabase/serverless";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env, MigratorDeps } from "./create-app";
import { resolveDsn } from "./database-url";
import { authenticateRequest } from "./request-auth";
import { MAX_PREFLIGHT_BYTES, parsePreflightMetadata } from "./preflight-metadata";
import { compareMigrationPrefix } from "./preflight-compatibility";
import { readRevisionSnapshot } from "./preflight-ledger";
import { hasPrismaSnapshot, PRISMA_TARGET } from "./prisma-target";
import { selectedExecutor } from "./selected-executor";
import type { PreflightMetadata } from "./preflight-metadata";

function authenticated(deps: MigratorDeps): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    c.header("Cache-Control", "no-store");
    const verified = await authenticateRequest(c.req.raw, c.env.MIGRATOR_OIDC_POLICY, deps);
    if (verified === null) return c.json({ error: "unauthorized" }, 401);
    if (!verified.ok || verified.claims.ref !== "refs/heads/main") return c.json({ error: "forbidden" }, 403);
    await next();
  };
}

function unavailable(c: Context<{ Bindings: Env }>, error: unknown): Response {
  if (error instanceof NeonDbError && error.code === "42P01") {
    return c.json({ compatible: false, error: "ledger_missing" }, 422);
  }
  return c.json({ error: "preflight_unavailable" }, 503);
}

async function preflight(c: Context<{ Bindings: Env }>, deps: MigratorDeps): Promise<Response> {
  try {
    const metadata = parsePreflightMetadata(await c.req.text());
    if (!metadata) return c.json({ error: "invalid_preflight" }, 400);
    if (metadata.stagingOnlyBaseline && c.env.MIGRATOR_OIDC_POLICY === "production") {
      return c.json({ compatible: false, error: "staging_only_baseline" }, 422);
    }
    if (metadata.expectedPrismaRef !== undefined && !await hasPrismaSnapshot(metadata.expectedPrismaRef, deps.migrationsDir)) {
      return c.json({ error: "stale_prisma_bundle", prismaTarget: PRISMA_TARGET }, 409);
    }
    const dsn = await resolveDsn(c.env);
    if (!dsn) return c.json({ error: "preflight_unavailable" }, 503);
    const result = await preview(c.env, deps, dsn, metadata);
    return c.json(result, result.compatible ? 200 : 422);
  } catch (error) {
    return unavailable(c, error);
  }
}

function preview(env: Env, deps: MigratorDeps, dsn: string, metadata: PreflightMetadata) {
  if (metadata.expectedPrismaRef !== undefined) {
    return selectedExecutor(env, deps).preflight(dsn, { ...metadata, expectedPrismaRef: metadata.expectedPrismaRef });
  }
  return readRevisionSnapshot(dsn).then((rows) => compareMigrationPrefix(metadata, rows));
}

export function registerPreflight(app: Hono<{ Bindings: Env }>, deps: MigratorDeps): void {
  app.post("/preflight", authenticated(deps), bodyLimit({
    maxSize: MAX_PREFLIGHT_BYTES,
    onError: (c) => c.json({ error: "invalid_preflight" }, 413),
  }), (c) => preflight(c, deps));
}
