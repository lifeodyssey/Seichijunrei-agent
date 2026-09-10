import assert from "node:assert/strict";
import test from "node:test";
import type { Miniflare } from "miniflare";
import { nativeWorker, request, inspect, releaseAndRestore, type Observation } from "./native-keepalive-fixture.ts";

async function activeKeepalive(worker: Miniflare, drive: Promise<string>) {
  await Promise.race([request(worker, "/entered"), drive.then(() => assert.fail("Drive must remain pending behind the provider barrier"))]);
  const active = await inspect(worker);
  assert.ok(active.deadlineId);
  assert.equal(active.driveActive, true);
  assert.ok(active.alarm !== null && active.alarm < active.deadlineTime);
  assert.equal(active.callbackCount, 0);
  return active;
}

async function disposedKeepalive(worker: Miniflare, drive: Promise<string>, active: Observation) {
  await request(worker, "/release");
  await drive;
  await request(worker, "/drain");
  const disposed = await inspect(worker);
  assert.equal(disposed.deadlineId, active.deadlineId);
  assert.equal(disposed.deadlineTime, active.deadlineTime);
  assert.equal(disposed.driveActive, false);
  assert.equal(disposed.alarm, active.deadlineTime, "SDK cleanup must retain the original physical deadline alarm");
}

async function deadlineCallback(worker: Miniflare) {
  await request(worker, "/fire");
  const completed = await inspect(worker, "/callback");
  assert.equal(completed.callbackCount, 1);
  assert.equal(completed.callbackDuringDrive, false);
  assert.equal(completed.completedStatus, "completed");
}

void test("active native keepalive preserves a deadline through cleanup and its actual alarm callback", { timeout: 30_000 }, async (context) => {
  const worker = await nativeWorker(context);
  const drive = request(worker, "/drive");
  try {
    const active = await activeKeepalive(worker, drive);
    await disposedKeepalive(worker, drive, active);
    await deadlineCallback(worker);
  } finally { await releaseAndRestore(worker, drive); }
});
