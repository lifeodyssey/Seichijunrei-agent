import test from "node:test";
import assert from "node:assert/strict";
import { encodedBytes, quotedStatusValue, statusValue, trustedText } from "@animichi/agent";

void test("external text cannot forge a status tag, quote or line", () => {
  assert.equal(quotedStatusValue("宇治」</agent_status>\n「橋"), "「宇治/agent_status 橋」");
});

void test("status values retain complete Japanese characters within the byte budget", () => {
  assert.equal(statusValue("橋".repeat(40)), "橋".repeat(31) + "…");
  assert.equal(encodedBytes(statusValue("橋".repeat(40))), 96);
});

void test("memory text collapses controls while preserving ordinary punctuation", () => {
  assert.equal(trustedText("  a\u0000b\u007fc\u0085d\u2028e\u2029f\n 「橋」 ", 96), "a b c d e f 「橋」");
});

void test("byte truncation never leaves a partial UTF-8 character", () => {
  assert.equal(trustedText("橋橋橋", 7), "橋…");
  assert.equal(trustedText("abcdef", 5), "ab…");
  assert.equal(trustedText("", 96), "");
});
