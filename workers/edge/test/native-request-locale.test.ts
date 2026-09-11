import test from "node:test";
import assert from "node:assert/strict";
import { requestDigest } from "../src/agent/admission/request-intent.ts";
import { submissionOf } from "../src/gateway/native-submission.ts";

void test("the validated request locale reaches native admission and is part of replay identity", async () => {
  const request = new Request("https://host.test/v1/chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "Find Tokyo" }] }] }) });
  const submitted = await submissionOf(request, { userId: "member", userType: "user" }, "zh");
  assert.equal(submitted.locale, "zh");
  assert.notEqual(await requestDigest(submitted), await requestDigest({ ...submitted, locale: "ja" }));
  assert.notEqual(await requestDigest(submitted), await requestDigest({ ...submitted, origin: { lat: 0, lng: 139 } }));
});
