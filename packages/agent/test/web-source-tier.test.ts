import test from "node:test";
import assert from "node:assert/strict";
import { classifySource } from "@animichi/agent";

void test("known source domains and their subdomains carry reputation labels", () => {
  assert.equal(classifySource("https://JA.wikipedia.org./wiki/Uji"), "verified");
  assert.equal(classifySource("http://bgm.tv/subject/485"), "verified");
});

void test("a substring, userinfo or redirect-looking path never upgrades a hostile source", () => {
  assert.equal(classifySource("https://notbgm.tv/"), "unverified");
  assert.equal(classifySource("https://wikipedia.org@evil.test/"), "unverified");
  assert.equal(classifySource("https://evil.test/wikipedia.org"), "unverified");
});

void test("missing or non-HTTP URLs remain unverified", () => {
  assert.equal(classifySource("not a url"), "unverified");
  assert.equal(classifySource(""), "unverified");
  assert.equal(classifySource("file:///etc/passwd"), "unverified");
});
