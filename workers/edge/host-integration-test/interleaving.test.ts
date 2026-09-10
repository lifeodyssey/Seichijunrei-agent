import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import type { Notification } from "pg";
import { pool, IDENTITY } from "./postgres.ts";
import { businessWorker, submission } from "./worker.ts";
import { holdConversation, blockedAdmission } from "./interleaving-postgres.ts";
import type { InterleavingReport } from "./interleaving.worker.ts";

void test("two writes and a real SDK scheduled callback remain exclusive while native admission awaits Neon", { timeout: 60_000 }, async (context) => {
  const { worker } = await businessWorker(context, {}, new URL("./interleaving.worker.ts", import.meta.url));
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *; LISTEN host_test_settled");
  const settled = once(observer, "notification", { signal: context.signal }).then((events) => events as [Notification], () => undefined);
  const locked = await holdConversation(context);
  const pending: Promise<unknown>[] = [];
  const post = (path: string, input = submission) => {
    const request = worker.dispatchFetch(`https://host.test${path}`,
      { method: "POST", body: JSON.stringify(input), signal: context.signal })
      .then(async (response) => ({ status: response.status, body: await response.text() }));
    pending.push(request.catch(() => undefined));
    return request;
  };
  const first = post("/submit");
  try {
    const blocked = await blockedAdmission(locked.pid, context.signal);
    assert.equal(blocked.length, 1);
    assert.match(blocked[0]?.query ?? "", /INSERT INTO sessions/);
    const second = post("/submit", { ...submission, clientMessageId: "second", text: "A second write" });
    const scheduled = await post("/schedule");
    assert.equal(scheduled.status, 200, scheduled.body);
    const response = await post("/contenders");
    assert.equal(response.status, 200, response.body);
    const during = JSON.parse(response.body) as InterleavingReport;
    await assertQueuedContention(during);
    await locked.release();
    const admitted = await first;
    assert.equal(admitted.status, 200, admitted.body);
    const accepted = JSON.parse(admitted.body) as { kind: string; operationId: string };
    assert.equal(accepted.kind, "accepted");
    const refused = await second;
    assert.equal(refused.status, 200, refused.body);
    assert.deepEqual(JSON.parse(refused.body) as unknown, { kind: "blocked", operationId: null });
    const event = await settled;
    assert.ok(event, "The actual scheduled drive must commit a settlement notification");
    const [notification] = event;
    assert.equal(notification.channel, "host_test_settled");
    assert.equal(notification.payload, accepted.operationId);
    await assertSettlement(accepted.operationId);
    const finalResponse = await post("/report");
    assert.equal(finalResponse.status, 200, finalResponse.body);
    const final = JSON.parse(finalResponse.body) as InterleavingReport;
    assertExclusiveHost(final);
    assert.equal(final.maxDrives, 1);
    assert.equal(final.driveCalls, 1);
  } finally { await locked.release(); await Promise.all(pending); }
});

function assertExclusiveHost(report: InterleavingReport) {
  assert.equal(report.initialized, 1);
  assert.equal(report.sessions, 1);
  assert.equal(report.harnesses, 1);
  assert.equal(report.maxActive, 1);
}

async function assertQueuedContention(report: InterleavingReport) {
  assertExclusiveHost(report);
  assert.equal(report.requests, 2);
  assert.ok(report.callbacks >= 1, "The actual SDK alarm callback must arrive before releasing Neon");
  assert.equal(report.active, 1);
  assert.equal(report.driveCalls, 0);
  assert.equal((await pool.query("SELECT operation_id FROM agent_admissions")).rowCount, 0);
  assert.equal((await pool.query("SELECT message_count FROM anon_daily_message_count")).rowCount, 0);
}

async function assertSettlement(operationId: string) {
  const admissions = await pool.query("SELECT operation_id,state FROM agent_admissions");
  assert.deepEqual(admissions.rows, [{ operation_id: operationId, state: "settled" }]);
  assert.deepEqual((await pool.query("SELECT message_count FROM anon_daily_message_count WHERE anon_id=$1", [IDENTITY])).rows, [{ message_count: "1" }]);
  assert.equal((await pool.query("SELECT operation_id FROM agent_open_operations")).rowCount, 0);
}
