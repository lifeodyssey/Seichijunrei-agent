import test from "node:test";
import assert from "node:assert/strict";
import { EgressPolicy } from "../src/agent/egress/egress-policy.ts";
import { hostAddressOf } from "@animichi/agent";

// W0-S5 (#1248): the address half of the red-line table — loopback, private,
// link-local, CGNAT, metadata and the merely-unroutable, in both IPv4 and IPv6
// including the IPv4-mapped and NAT64 spellings that a dotted-quad denylist
// cannot see. Each row is refused with the reason that names its range, not
// with a generic "not on the allowlist": the classification is an independent
// second condition, and a test that accepted any refusal would not notice it
// disappearing.
//
// test-type: unit (pure decision, no network, no clock, no bindings).

const KEY = "sk-spike-000000000000";
const policy = new EgressPolicy();

function reasonFor(baseUrl: string): string {
  const decision = policy.decide({ provider: "openai", baseUrl, key: KEY });
  return decision.allowed ? "allowed" : decision.reason;
}

const ADDRESS_ROWS: readonly [string, string][] = [
  ["https://169.254.169.254/latest/meta-data", "metadata_address"],
  ["https://metadata.google.internal/computeMetadata/v1", "metadata_address"],
  ["https://100.100.100.200/", "metadata_address"],
  ["https://192.0.0.192/", "metadata_address"],
  ["https://[fd00:ec2::254]/", "metadata_address"],
  ["https://[::ffff:169.254.169.254]/", "metadata_address"],
  ["https://2852039166/", "metadata_address"],
  ["https://10.0.0.1/", "private_address"],
  ["https://172.16.0.1/", "private_address"],
  ["https://172.31.255.255/", "private_address"],
  ["https://192.168.1.1/", "private_address"],
  ["https://[fd00::1]/", "private_address"],
  ["https://[fc00::1]/", "private_address"],
  ["https://127.0.0.1/", "loopback_address"],
  ["https://127.1/", "loopback_address"],
  ["https://0x7f000001/", "loopback_address"],
  ["https://[::1]/", "loopback_address"],
  ["https://[::ffff:127.0.0.1]/", "loopback_address"],
  ["https://[64:ff9b::7f00:1]/", "loopback_address"],
  ["https://169.254.1.1/", "link_local_address"],
  ["https://[fe80::1]/", "link_local_address"],
  ["https://100.64.0.1/", "cgnat_address"],
  ["https://100.127.255.254/", "cgnat_address"],
  ["https://0.0.0.0/", "unroutable_address"],
  ["https://[::]/", "unroutable_address"],
  ["https://255.255.255.255/", "unroutable_address"],
  ["https://[ff02::1]/", "unroutable_address"],
  ["https://198.18.0.1/", "unroutable_address"],
  ["https://1.1.1.1/", "ip_literal_host"],
  ["https://[2606:4700:4700::1111]/", "ip_literal_host"],
];

for (const [baseUrl, reason] of ADDRESS_ROWS) {
  void test(`${baseUrl} is refused as ${reason}`, () => {
    assert.equal(reasonFor(baseUrl), reason);
  });
}

void test("172.15 and 172.32 are outside RFC1918 and are not called private", () => {
  assert.equal(reasonFor("https://172.15.0.1/"), "ip_literal_host");
  assert.equal(reasonFor("https://172.32.0.1/"), "ip_literal_host");
});

void test("100.63 and 100.128 are outside the CGNAT block", () => {
  assert.equal(reasonFor("https://100.63.0.1/"), "ip_literal_host");
  assert.equal(reasonFor("https://100.128.0.1/"), "ip_literal_host");
});

void test("the WHATWG parser is what normalises the encoded IPv4 spellings", () => {
  assert.equal(new URL("https://2852039166/").hostname, "169.254.169.254");
  assert.equal(new URL("https://0x7f000001/").hostname, "127.0.0.1");
  assert.equal(new URL("https://[::ffff:169.254.169.254]/").hostname, "[::ffff:a9fe:a9fe]");
});

void test("a provider hostname is classified as a name, never as an address", () => {
  assert.deepEqual(hostAddressOf("api.openai.com"), { host: "api.openai.com", kind: "dns-name" });
  assert.deepEqual(hostAddressOf("api.openai.com."), { host: "api.openai.com", kind: "dns-name" });
});

void test("a malformed bracketed host is refused rather than treated as a name", () => {
  assert.equal(hostAddressOf("[not:an:address:::]").kind, "unroutable");
});
