import assert from "node:assert/strict";
import test from "node:test";
import { reconnectWorker } from "./reconnect-worker.ts";
import { nativeWebServer } from "../../../apps/web/tests/native-server.ts";
import { nativeRecoveryPage, submitNativeChat } from "../../../e2e/native-recovery-driver.ts";
import { observeNativeHeartbeat, surviveNativeSilence, expectSilentAnswer } from "../../../e2e/native-heartbeat-driver.ts";

void test("a real heartbeat keeps a silent native stream alive beyond the browser's former whole-turn timeout", { timeout: 90_000 }, async (context) => {
  const native = await reconnectWorker(context);
  const url = await nativeWebServer(context, await native.worker.ready);
  const page = await nativeRecoveryPage(context, url);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const heartbeat = await observeNativeHeartbeat(page);
  const accepted = await submitNativeChat(page);
  await native.entered;
  await surviveNativeSilence(page, heartbeat);
  assert.ok(accepted.operationId);
  native.release();
  await page.clock.resume();
  await expectSilentAnswer(page);
  assert.equal(native.requests.length, 1);
});
