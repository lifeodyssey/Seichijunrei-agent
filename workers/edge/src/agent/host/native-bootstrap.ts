import { requireOperationTools } from "./operation-tool-settings.ts";
import postgres from "@prisma/orm-postgres/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import { NeonSessionRepo } from "@animichi/pi-session-neon";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session, SessionMetadata } from "@earendil-works/pi-agent-core/harness/session";
import { createCatalogClient } from "@animichi/agent/tools";
import type { Env } from "../../env.ts";
import { nativeHostModels } from "./native-models.ts";
import { requireToolAuthority } from "./native-authority.ts";
import { NATIVE_AGENT_OPTIONS } from "@animichi/agent";

async function readSecret(value: { get(): Promise<string> } | string | undefined) {
  return typeof value === "string" ? value : await value?.get();
}

export function anonymousDailyBudget(value: string | undefined) {
  const budget = value === undefined ? 5 : Number(value);
  if (!Number.isFinite(budget) || budget < 0) throw new Error("Anonymous daily budget is invalid");
  return budget;
}

/** One DO incarnation owns these direct native resources; no module-global socket or alternate store. */
export async function bootstrapNativeSession(env: Env, id: string, context: Context) {
  const url = await readSecret(env.AGENT_SVC_DATABASE_URL);
  if (!url) throw new Error("The native agent database is not configured");
  const db = postgres<Contract>({ contractJson, url });
  try {
    const server = await nativeHostModels(await readSecret(env.MIMO_API_KEY));
    const repo = new NeonSessionRepo(db);
    const row = await db.orm.public.PiSession.where({ id }).first();
    const created = row ? undefined : await repo.create({ id }, context);
    const metadata = created?.metadata ?? row?.metadata as unknown as SessionMetadata;
    await created?.close(context);
    const budget = anonymousDailyBudget(env.ANON_DAILY_COST_BUDGET_USD);
    const compose = (session: Session) => ({ models: server.models, model: server.model, ...NATIVE_AGENT_OPTIONS,
      toolContext: (toolsContext: Context) => ({ session, branch: "main", ...requireOperationTools(toolsContext),
        catalog: createCatalogClient((request) => env.CATALOG.fetch(request)),
        assertAuthorized: (operationId: string, toolsContext: Context) => requireToolAuthority(db, id, operationId, budget, toolsContext),
        reserveToolUsage: (_invocationId: string, toolsContext: Context, operationId: string) => requireToolAuthority(db, id, operationId, budget, toolsContext) }) });
    return { db, repo, metadata, compose, server, budget };
  } catch (error) { await db.close(); throw error; }
}
export type NativeSessionResources = Awaited<ReturnType<typeof bootstrapNativeSession>>;
