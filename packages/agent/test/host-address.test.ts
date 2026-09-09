import test from "node:test";
import assert from "node:assert/strict";
import { hostAddressOf, type HostAddressClass } from "@animichi/agent";

const ADDRESSES: readonly [string, HostAddressClass][] = [
  ["api.openai.com", "dns-name"], ["256.1.1.1", "dns-name"],
  ["metadata.google.internal", "metadata"], ["169.254.169.254", "metadata"],
  ["100.100.100.200", "metadata"], ["192.0.0.192", "metadata"],
  ["127.0.0.1", "loopback"], ["10.2.3.4", "private"],
  ["172.16.0.1", "private"], ["192.168.1.1", "private"],
  ["169.254.1.1", "link-local"], ["100.64.0.1", "cgnat"],
  ["0.0.0.0", "unroutable"], ["224.1.1.1", "unroutable"],
  ["192.0.2.1", "unroutable"], ["198.18.0.1", "unroutable"],
  ["198.19.0.1", "unroutable"], ["198.51.100.1", "unroutable"],
  ["203.0.113.1", "unroutable"], ["8.8.8.8", "routable-ip"],
  ["[::1]", "loopback"], ["[::]", "unroutable"],
  ["[fd00:ec2::254]", "metadata"], ["[fc00::1234]", "private"],
  ["[fe80::1]", "link-local"], ["[ff02::1]", "unroutable"],
  ["[::ffff:a9fe:a9fe]", "metadata"], ["[64:ff9b::7f00:1]", "loopback"],
  ["[2001:4860:4860::8888]", "routable-ip"],
  ["[2001:4860:4860:0:0:0:0:8888]", "routable-ip"],
  ["", "unroutable"], ["[not-ip]", "unroutable"],
  ["[1::2::3]", "unroutable"], ["[1:2:3]", "unroutable"],
  ["[1:2:3:4:5:6:7:8::9]", "unroutable"],
  ["[::nope]", "unroutable"],
];

for (const [host, kind] of ADDRESSES) {
  void test(`classify literal ${host} as ${kind}`, () => {
    assert.deepEqual(hostAddressOf(host), { host, kind });
  });
}

void test("WHATWG normalization and root labels cannot conceal a metadata address", () => {
  assert.deepEqual(hostAddressOf(new URL("https://0xA9FEA9FE/").hostname), { host: "169.254.169.254", kind: "metadata" });
  assert.deepEqual(hostAddressOf("metadata.google.internal."), { host: "metadata.google.internal", kind: "metadata" });
});
