import assert from "node:assert/strict";
import test from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { messageProjection } from "../src/agent/views/message-chunks.ts";
import { SecretScrub } from "../src/agent/egress/secret-scrub.ts";

void test("native message updates preserve text and reasoning semantics without exposing a credential split across chunks", () => {
  const secret = "private-example-credential";
  const project = messageProjection(new SecretScrub([secret]));
  const prefix = "Visible words ".repeat(40);
  const partial = { ...fauxAssistantMessage(prefix + secret.slice(0, 8)), timestamp: 0 };
  const complete = { ...fauxAssistantMessage(prefix + secret), timestamp: 0 };
  const chunks = [...project.update(partial, false), ...project.update(complete, true)];
  const text = chunks.flatMap((chunk) => chunk.type === "text-delta" ? chunk.delta : []).join("");
  assert.equal(text, prefix + "[redacted]");
  assert.equal(chunks.filter((chunk) => chunk.type === "text-start").length, 1);
  assert.equal(chunks.filter((chunk) => chunk.type === "text-end").length, 1);
  assert.deepEqual(project.update(complete, true), []);
  project.begin();
  const reasoning = { ...fauxAssistantMessage(""), timestamp: 1, content: [{ type: "thinking" as const, thinking: "Reason safely" }] };
  assert.deepEqual(project.update(reasoning, true).map((chunk) => chunk.type), ["reasoning-start", "reasoning-delta", "reasoning-end"]);
});
