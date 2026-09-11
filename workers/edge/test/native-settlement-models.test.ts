import assert from "node:assert/strict";
import { test } from "node:test";
import { settlementModels } from "../agent-db-test/settlement-models.ts";

void test("the published native provider records each model's actual per-call price before settlement", async () => {
  const { models, model } = settlementModels();
  const prompt = { messages: [{ role: "user" as const, content: "hello", timestamp: 0 }] };
  const first = await models.completeSimple(model, prompt);
  assert.equal(first.stopReason, "stop");
  assert.equal(first.usage.cost.total.toFixed(6), "0.300000");
  const second = models.getModel("settlement-price", "second");
  assert.ok(second);
  const response = await models.completeSimple(second, prompt);
  assert.equal(response.stopReason, "stop");
  assert.equal(response.usage.input, 100);
  assert.equal(response.usage.cost.total.toFixed(6), "0.000003");
});
