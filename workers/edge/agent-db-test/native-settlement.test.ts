import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentHarness, MemorySessionRepo } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { prepareOperationSettlement, settleModelOperation } from "../src/agent/settlement/native-settlement.ts";
import { db, SESSION } from "./settlement-fixture.ts";

void test("a durable refusal refunds the reserved UTC day exactly once after native cancellation", async () => {
  const repo = new MemorySessionRepo({ now: () => 1_789_000_000_000 });
  const session = await repo.create({ id: SESSION }, context);
  const provider = fauxProvider();
  const models = createModels(); models.setProvider(provider.provider);
  const { harness } = await AgentHarness.create({ session, models, model: provider.getModel() }, context);
  try {
    const lane = await harness.lane("main", context);
    await db.orm.public.AgentAdmission.create({ sessionId: SESSION, clientMessageId: "request", kind: "model", operationId: "refused", identityId: "anon_identity", payer: "anon", requestDigest: "digest", state: "accepted", rejectionReason: "identity_revoked", quotaUsageDate: "2026-09-09", quotaReservedAt: "2026-09-09T23:59:00Z" });
    await db.runtime().execute(db.raw.sql`INSERT INTO anon_daily_message_count (usage_date, anon_id, message_count) VALUES ('2026-09-09', 'anon_identity', 1) ON CONFLICT (usage_date, anon_id) DO UPDATE SET message_count = 1`.affectedCount().build());
    await db.orm.public.AgentSettlement.create({ operationId: "refused" });
    await lane.accept({ kind: "prompt", prompt: "hello", operationId: "refused" }, context);
    assert.equal(await prepareOperationSettlement(db, session, "refused", context), true);
    await lane.requestAbort("refused", context);
    await lane.drive({ operationId: "refused", waitForRetry: false }, context);
    assert.equal((await settleModelOperation(db, session, lane, "refused", context, 1_789_000_000_000))?.status, "aborted");
    assert.equal((await settleModelOperation(db, session, lane, "refused", context, 1_789_000_000_000))?.status, "aborted");
    const admission = await db.orm.public.AgentAdmission.where({ operationId: "refused" }).first();
    assert.equal(admission?.state, "settled");
    assert.ok(admission.quotaRefundedAt);
    const count = await db.runtime().query(db.raw.sql`SELECT message_count::text AS count FROM anon_daily_message_count WHERE usage_date = '2026-09-09' AND anon_id = 'anon_identity'`.returnsRow({ count: "pg/text@1" }).build());
    assert.equal(count[0]?.count, "0");
    assert.ok((await db.orm.public.AgentSettlement.where({ operationId: "refused" }).first())?.settledAt);
  } finally { await harness.close(context); await repo.close(context); }
});
