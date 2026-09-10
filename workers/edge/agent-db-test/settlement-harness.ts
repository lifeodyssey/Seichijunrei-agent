import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { AgentHarness, type AgentHarnessOptions, type AgentLane } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import { createModels, fauxProvider, type AssistantMessage } from "@earendil-works/pi-ai";
import { NeonSessionRepo } from "@animichi/pi-session-neon";
import { prepareOperationSettlement } from "../src/agent/settlement/native-settlement.ts";
import { db, SESSION } from "./settlement-fixture.ts";

export const SETTLED_AT = Date.UTC(2026, 8, 10, 1);

export async function settlementHarness(test: TestContext, responses: AssistantMessage[], tools?: AgentHarnessOptions["tools"], composition?: Pick<AgentHarnessOptions, "models" | "model">) {
  const repo = new NeonSessionRepo(db);
  const session = await repo.open({ id: SESSION, createdAt: 1, storageVersion: 1 }, context);
  const provider = fauxProvider(); provider.setResponses(responses);
  const models = createModels(); models.setProvider(provider.provider);
  const { harness } = await AgentHarness.create({ session, models, model: provider.getModel(), tools, ...composition }, context);
  test.after(() => harness.close(context));
  return { session, harness, lane: await harness.lane("main", context) };
}

export async function acceptOperation(session: Session, lane: AgentLane, operationId: string, payer = "user") {
  await db.orm.public.AgentAdmission.create({ sessionId: SESSION, clientMessageId: operationId, kind: "model", operationId,
    identityId: "identity", payer, requestDigest: "digest", state: "accepted" });
  await db.orm.public.AgentSettlement.create({ operationId });
  await db.orm.public.AgentOpenOperation.create({ operationId });
  assert.equal((await lane.accept({ kind: "prompt", operationId, prompt: "hello" }, context)).ok, true);
  assert.equal(await prepareOperationSettlement(db, session, operationId, context), true);
}

export function dailyUsage() {
  return db.runtime().query(db.raw.sql`SELECT scope, requests::integer AS requests, input_tokens::integer AS input_tokens,
    output_tokens::integer AS output_tokens, cost_usd::text AS cost_usd FROM daily_usage ORDER BY scope`
    .returnsRow({ scope: "pg/text@1", requests: "pg/int4@1", input_tokens: "pg/int4@1", output_tokens: "pg/int4@1", cost_usd: "pg/text@1" }).build());
}
