import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const wranglerToml = repoFile("../wrangler.toml");

/** The `wrangler.toml` section starting at `header`, up to the next section. */
function blockForHeader(header: string): string {
  const headerIndex = wranglerToml.indexOf(`\n${header}\n`);
  assert.ok(headerIndex >= 0, `wrangler.toml must contain a "${header}" section header line`);
  const nextHeaderIndex = wranglerToml.indexOf("\n[", headerIndex + header.length);
  return wranglerToml.slice(headerIndex, nextHeaderIndex === -1 ? undefined : nextHeaderIndex);
}

function hasRetiredSwitch(header: string): boolean {
  return /^AGENT_TURN_ROUTE\s*=/m.test(blockForHeader(header));
}

void test("staging has no retired runtime switch", () => {
  assert.equal(hasRetiredSwitch("[env.staging.vars]"), false);
});

void test("production has no retired runtime switch", () => {
  assert.equal(hasRetiredSwitch("[env.production.vars]"), false);
});

void test("local development has no retired runtime switch", () => {
  assert.equal(hasRetiredSwitch("[vars]"), false);
});

void test("the anonymous daily allowance the edge tier enforces is set in all three environments", () => {
  const configured = ["[vars]", "[env.production.vars]", "[env.staging.vars]"].map(
    (header) => /^ANON_DAILY_MESSAGE_QUOTA = "([^"]+)"/m.exec(blockForHeader(header))?.[1],
  );
  assert.deepEqual(configured, ["20", "20", "20"]);
});
