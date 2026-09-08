/** `stagingAccessAllowedEmails`, as a specification over its values.
 *
 * The resources built from it are `topology-staging-access.test.ts`; this is the
 * rule that decides what may reach them. Pinned on the exported pure function
 * rather than through repeated `buildStack` calls: `index.ts` builds at import
 * time, and a module that throws during evaluation is cached in its errored
 * state, so a second build in one process replays the FIRST failure and every
 * later case passes vacuously. `topology-staging-empty-allowlist.test.ts` is the
 * one program-level case, in its own process for exactly that reason.
 *
 * The stack is built first only so `index.ts` imports against mocks instead of
 * attempting a real engine RPC.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStack } from "./testing/harness.ts";

await buildStack("staging", {
  cloudflareAccountId: "acct",
  cloudflareZoneId: "zone",
  webRoutesEnabled: "true",
  stagingDomain: "staging.animichi.com",
  stagingAccessAllowedEmails: '["owner@example.test"]',
});

const { validateAccessAllowedEmails } = await import("./index.ts");

test("an allowlist nobody is on is refused rather than applied", () => {
  // An `allow` policy with no include rules is an application no human can
  // open, and the first person to find that out is the owner, locked out.
  assert.throws(() => validateAccessAllowedEmails([]), /stagingAccessAllowedEmails is empty/);
});

test("the entry that is wrong is the one the error names", () => {
  // A list is edited one address at a time; an error that says only "invalid"
  // sends the operator back to read all of them.
  assert.throws(
    () => validateAccessAllowedEmails(["owner@example.test", "not-an-address"]),
    /stagingAccessAllowedEmails entry "not-an-address" is not an email address/,
  );
});

/** Every shape that is not a whole address (CodeRabbit on PR #1520).
 *
 * The empty allowlist wearing a disguise: Cloudflare stores whatever string it
 * is handed as the `email` selector, so half an address becomes an include rule
 * no authenticated identity can ever equal — an application that applies
 * cleanly and admits nobody. One case per shape rather than a loop with
 * assertions inside it, so a regression names the one it lost.
 */
const NOT_WHOLE_ADDRESSES = [
  "@example.test",
  "owner @example.test",
  "owner@",
  "owner@example",
  "a@b@c.test",
];

for (const entry of NOT_WHOLE_ADDRESSES) {
  test(`"${entry}" is refused rather than handed to Access as a selector`, () => {
    assert.throws(() => validateAccessAllowedEmails([entry]), /is not an email address/);
  });
}

test("a real address, subdomained or not, still passes", () => {
  // The control for the block above. If the pattern rejected everything, every
  // case there would pass while no allowlist could ever be applied — and the
  // deployed door would have no humans on it.
  assert.deepEqual(
    validateAccessAllowedEmails(["owner@example.test", "first.last@sub.example.co.jp"]),
    ["owner@example.test", "first.last@sub.example.co.jp"],
  );
});
