import assert from "node:assert/strict";
import { test } from "node:test";
import type { Entry, UsageRow } from "@earendil-works/pi-agent-core/harness/session";
import { chargeUsage } from "../src/agent/settlement/usage-charge.ts";

const usage: UsageRow = { id: "usage", seq: 2, adjustment: false, usage: { input: 10, output: 20, cacheRead: 300, cacheWrite: 400,
  totalTokens: 730, cost: { input: 0.001, output: 0.002, cacheRead: 0.003, cacheWrite: 0.004, total: 0.01 } } };
const translation: Entry = { id: "translation", seq: 1, parentId: null, timestamp: 0, type: "message", message: {
  role: "toolResult", toolCallId: "call", toolName: "translate_anime_title", content: [], isError: false, timestamp: 0, details: { payer: "platform" } } };

void test("native per-call cost includes cache pricing while the existing token columns retain their meaning", () => {
  assert.deepEqual(chargeUsage(usage, undefined, "user"), { scope: "user", requests: 1, inputTokens: 10, outputTokens: 20, costUsd: "0.01" });
});

void test("unpriced native usage retains tokens and the recorded zero without inferring a model price", () => {
  const unpriced = { ...usage, usage: { ...usage.usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  assert.equal(chargeUsage(unpriced, undefined, "anon").costUsd, "0");
  assert.equal(chargeUsage(unpriced, undefined, "anon").outputTokens, 20);
});

void test("caller-keyed model calls are zero platform cost but server-paid translation uses recorded cost", () => {
  assert.equal(chargeUsage(usage, undefined, "byok").costUsd, "0");
  assert.equal(chargeUsage({ ...usage, entryId: translation.id }, translation, "byok").scope, "platform");
  assert.equal(chargeUsage({ ...usage, entryId: translation.id }, translation, "byok").costUsd, "0.01");
});

void test("a ledger adjustment changes usage without inventing a provider request", () => {
  assert.equal(chargeUsage({ ...usage, adjustment: true }, undefined, "user").requests, 0);
});

void test("missing native usage entries fail closed instead of losing tool payer evidence", () => {
  assert.throws(() => chargeUsage({ ...usage, entryId: "missing" }, undefined, "byok"), /usage entry is missing/);
});
