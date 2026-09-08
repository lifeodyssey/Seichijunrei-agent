import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { accountId, stack } from "./config.ts"

// ── Staging: the Cloudflare Access service token (D3 #1369, PR 1) ─────────────
// The credential automation presents at staging's front door. It is minted here
// and nowhere else, and it is deliberately minted BEFORE the Access application
// that will check it (PR 2): an application enforces the moment its policy
// exists, so a single PR that created both would lock every caller out for the
// length of the rollout. This PR mints the token and teaches the callers the two
// headers; PR 2 puts the door in front of them.
//
// The two outputs below are the ESC environment's import source. Pulumi ESC's
// `pulumi-stacks` provider reads a stack's OUTPUTS by name, so the names are the
// contract: `lifeodyssey/animichi/staging` maps `stagingAccessClientId` →
// `CF_ACCESS_CLIENT_ID` and `stagingAccessClientSecret` → `CF_ACCESS_CLIENT_SECRET`
// under `environmentVariables`. Renaming either output silently empties the ESC
// keys, so `topology-staging.test.ts` pins both names.
//
// Staging only. Production has no Access application (spec §3.3), and a token
// minted for a door that does not exist is a live credential in state with no
// consumer — the stack check is what keeps it from being created there.

/** The Cloudflare-side name an operator sees in the Zero Trust dashboard. */
const TOKEN_NAME = "animichi-staging-ci";

/**
 * One year, the provider's own default, written out rather than inherited.
 * Rotation is explicit (bump `clientSecretVersion`), never time-triggered, so
 * the expiry is a date somebody has to act on and it should be readable here.
 */
const TOKEN_DURATION = "8760h";

function mintStagingCiToken(): cloudflare.ZeroTrustAccessServiceToken {
  return new cloudflare.ZeroTrustAccessServiceToken("staging-ci", {
    accountId,
    name: TOKEN_NAME,
    duration: TOKEN_DURATION,
  });
}

const stagingCiToken = stack === "staging" ? mintStagingCiToken() : undefined;

/** The value Access checks in the `CF-Access-Client-Id` request header. */
export const stagingAccessClientId = stagingCiToken?.clientId;

/**
 * The value Access checks in the `CF-Access-Client-Secret` request header.
 *
 * Sealed explicitly. `AGENTS.md` states the cost of getting this wrong: an
 * unmarked value is written into Pulumi Cloud state in the clear and comes back
 * out in the clear in any operator `pulumi stack export`, and this repository is
 * public. The provider marks the attribute sensitive on its own; this asserts
 * the property rather than trusting one mechanism for it, exactly as the WAF
 * gate expression does in `staging.ts`.
 */
export const stagingAccessClientSecret =
  stagingCiToken === undefined ? undefined : pulumi.secret(stagingCiToken.clientSecret);
