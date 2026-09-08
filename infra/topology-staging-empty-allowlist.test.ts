/** An empty `stagingAccessAllowedEmails` must stop the BUILD, not the operator.
 *
 * Separate file, and only one case in it, because `index.ts` builds at import
 * time: a module that throws during evaluation is cached in its errored state,
 * so a second `buildStack` in this process would replay this same failure and
 * pass vacuously. The refusal's own shapes are unit-tested on the exported
 * function in `topology-staging-access.test.ts`; this is the program-level half —
 * that the config actually reaches it. Parity with the `buildIpClause` file the
 * deleted WAF gate had (`topology-staging-invalid-ip.test.ts`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStack } from "./testing/harness.ts";

test("a staging stack with nobody on the allowlist refuses to build", async () => {
  // An `allow` policy with no include rules is an application no human can open,
  // and the first person to find that out would be the owner, locked out.
  await assert.rejects(
    () =>
      buildStack("staging", {
        cloudflareAccountId: "acct",
        cloudflareZoneId: "zone",
        webRoutesEnabled: "true",
        stagingDomain: "staging.animichi.com",
        stagingAccessAllowedEmails: "[]",
      }),
    /stagingAccessAllowedEmails is empty/,
  );
});
