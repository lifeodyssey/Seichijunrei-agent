import assert from "node:assert/strict";
import test from "node:test";
import { submissionOf } from "../src/gateway/native-submission.ts";
import { ChatEnvelopeError } from "../src/gateway/chat-envelope.ts";

function submit(fields: object) {
  const request = new Request("https://agent.example/v1/chat", { method: "POST",
    headers: { "content-type": "application/json", "x-session-id": "origin-session", "x-turn-id": "origin-turn" },
    body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "Search nearby" }] }], ...fields }) });
  return submissionOf(request, { userId: "user-1", userType: "authenticated" }, "ja");
}

function invalidBody(error: unknown) {
  assert.ok(error instanceof ChatEnvelopeError);
  assert.equal(error.refusal, "invalid_body");
  return true;
}

void test("ordinary chat preserves exact shared GPS, including zero latitude", async () => {
  const submission = await submit({ origin_lat: 0, origin_lng: 139.456789 });
  assert.deepEqual(submission.origin, { lat: 0, lng: 139.456789 });
});

void test("ordinary chat without shared GPS does not invent an origin", async () => {
  assert.equal((await submit({})).origin, undefined);
});

void test("ordinary chat rejects latitude without longitude", async () => {
  await assert.rejects(submit({ origin_lat: 35 }), invalidBody);
});

void test("ordinary chat rejects longitude without latitude", async () => {
  await assert.rejects(submit({ origin_lng: 139 }), invalidBody);
});

void test("ordinary chat rejects coordinates outside the earth's bounds", async () => {
  await assert.rejects(submit({ origin_lat: 91, origin_lng: 139 }), invalidBody);
});

void test("ordinary chat rejects strings in the numeric GPS fields", async () => {
  await assert.rejects(submit({ origin_lat: "35", origin_lng: 139 }), invalidBody);
});
