import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { accountId, config, stack } from "./config.ts"

// ── Staging: the Cloudflare Access front door (D3 #1369) ─────────────────────
// Staging runs the same app as production *with anonymous access on*
// (`ANON_ACCESS_ENABLED = "true"`, root wrangler.toml), so there is no login of
// its own keeping strangers out. Access is that login: humans sign in against
// the identity policy below, automation presents the service token, and both
// are decided by Cloudflare before a request is billed as a Worker invocation.
//
// It replaces the WAF custom rule this file's neighbour used to declare. That
// rule could only ever cover hostnames on the zone, which left the two
// `*.workers.dev` origins CD actually smoke-tests wide open (#539) — an Access
// application takes them as ordinary public destinations.
//
// Shipped in two PRs on purpose: an application enforces the moment its policy
// exists, so PR 1 minted the token and taught every caller the two headers, and
// this one puts the door in front of them. Access is eventually consistent
// (spec §六 第 2 条), so enforcement lags the apply by a minute or two.
//
// Staging only. Production has no Access application — it has a real login —
// and `topology-prod.test.ts` pins that nothing here is built there.

/** The Cloudflare-side name an operator sees in the Zero Trust dashboard. */
const TOKEN_NAME = "animichi-staging-ci";

/**
 * One year, the provider's own default, written out rather than inherited.
 * Rotation is explicit (bump `clientSecretVersion`), never time-triggered, so
 * the expiry is a date somebody has to act on and it should be readable here.
 */
const TOKEN_DURATION = "8760h";

/** The application's name in the Zero Trust dashboard and on the login page. */
const APPLICATION_NAME = "animichi staging";

/** How long a human's Access session lasts before Cloudflare asks again. */
const SESSION_DURATION = "24h";

/** What the login page calls the identity provider below. */
const OTP_PROVIDER_NAME = "One-time PIN";

/**
 * A whole address, which is all this needs to decide.
 *
 * Not an attempt at RFC 5322 — that grammar admits quoted local parts and
 * comments, and a validator that chases it is a source of false rejections for
 * no gain here. The failures worth catching are the ones that produce a
 * SELECTOR NOTHING CAN MATCH: an empty local part (`@example.com`), an empty or
 * dotless domain (`owner@`, `owner@example`), whitespace anywhere
 * (`owner @example.com`), and more than one `@`. Everything else is Cloudflare's
 * problem at sign-in time, where it is visible.
 */
const COMPLETE_ADDRESS = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * The two origins that are NOT on the zone, and so were never behind the WAF
 * rule this replaces.
 *
 * These are the literal hostnames `cd.yml`'s smoke job probes (pinned there by
 * `.github/scripts/test_cd_publish_contract.rb`), and CD probes them rather
 * than the zone hostname because GitHub-runner IPs get a managed challenge at
 * the zone front door. A staging surface CI can reach and Access cannot see is
 * the hole #539 opened; listing them here is what closes it.
 */
const WORKERS_DEV_HOSTS = [
  "animichi-staging.zhenjiazhou0127.workers.dev",
  "animichi-web-staging.zhenjiazhou0127.workers.dev",
];

function mintStagingCiToken(): cloudflare.ZeroTrustAccessServiceToken {
  return new cloudflare.ZeroTrustAccessServiceToken("staging-ci", {
    accountId,
    name: TOKEN_NAME,
    duration: TOKEN_DURATION,
  });
}

/** Every hostname the application secures, primary first. */
function securedHostnames(): string[] {
  return [config.require("stagingDomain"), ...WORKERS_DEV_HOSTS];
}

/**
 * The hostnames as `destinations`, which is the field that is not on its way
 * out.
 *
 * `selfHostedDomains` would take the same strings, and is what a search still
 * finds first, but the installed provider marks it `@deprecated` and states the
 * sunset outright: "This field is deprecated in favor of `destinations` and
 * will be supported until **November 21, 2025.** If `destinations` are
 * provided, then `selfHostedDomains` will be ignored"
 * (`@pulumi/cloudflare@6.19.0`, `zeroTrustAccessApplication.d.ts` — the
 * `selfHostedDomains?` member of `ZeroTrustAccessApplicationArgs`). That date is
 * behind us, and the failure mode of a field the API has stopped reading is the
 * silent one: the application would exist, cover its primary `domain` alone,
 * and leave the two workers.dev origins open with everything green.
 *
 * A public destination carries a `uri`, not a `hostname` — `hostname` is the
 * private-network form ("Matches a valid SNI served by an HTTPS origin"), while
 * `uri` is documented as "Public destinations' URIs can include a domain and
 * path" and is what the provider's own example uses
 * (`ZeroTrustAccessApplicationDestination`, `types/input.d.ts:16196-16226`).
 * A bare hostname is a whole-host URI, which is what this wants.
 *
 * `type: "public"` and not `"worker"`: the account-level Worker destination
 * types Cloudflare shipped in 2026-08 are not in this provider's schema at all —
 * its enum is "public", "private".
 *
 * Both facts below are measured, not inferred (N4b, 2026-09-08, throwaway app on
 * an idle workers.dev host, deleted afterwards):
 *
 *   - `destinations[].uri` DOES enforce on a workers.dev host. Once Access had
 *     propagated (~20 s) a path reached only through `destinations` answered 403
 *     bare and passed through to the Worker with the two headers, exactly as the
 *     `domain` spelling N4 probed did.
 *   - **The API requires `domain` to be one of the destinations.** Creating an
 *     application whose `domain` was absent from the list was refused outright:
 *     `12130 access.api.error.invalid_request: domain not included in
 *     destinations`. `securedHostnames()` puts `stagingDomain` first and
 *     `publishAccessApplication` passes the same value as `domain`, which is what
 *     satisfies that rule; `topology-staging-access.test.ts` pins the pairing,
 *     because getting it wrong is not a wrong door but a failed apply.
 *   - **A `uri` is path-scoped.** In the probe a third path, named in no
 *     destination, reached the Worker unauthenticated. These are bare hostnames
 *     on purpose: a bare host is the whole host. Appending a path to one here
 *     would quietly un-protect everything else on it.
 */
function publicDestinations(): { type: string; uri: string }[] {
  return securedHostnames().map((uri) => ({ type: "public", uri }));
}

/**
 * The humans Access lets in, read from stack config rather than written here.
 *
 * Config because the list changes for reasons that have nothing to do with the
 * code — somebody joins, somebody's address changes — and a stack value is the
 * one place an operator can edit it without a deploy of the program. Not a
 * secret: these addresses identify who may sign in, they do not authenticate
 * anybody, and `secure:` here would only make the allowlist unreadable in
 * review.
 *
 * Empty is refused rather than applied. An `allow` policy with no include rules
 * is an application no human can open, and the first person to find that out is
 * the owner locked out of staging. An entry that is not a whole address is
 * refused for the same reason, one step earlier: Cloudflare stores whatever
 * string it is handed as the `email` selector, and a selector no authenticated
 * identity can ever equal is an include rule that never fires. An allowlist made
 * only of those is the empty allowlist wearing a disguise, and it would apply
 * cleanly (CodeRabbit on PR #1520).
 */
export function validateAccessAllowedEmails(emails: string[]): string[] {
  if (emails.length === 0) {
    throw new Error("stagingAccessAllowedEmails is empty: no human could sign in to staging");
  }
  const invalid = emails.find((email) => !COMPLETE_ADDRESS.test(email));
  if (invalid !== undefined) {
    throw new Error(`stagingAccessAllowedEmails entry "${invalid}" is not an email address`);
  }
  return emails;
}

function allowedEmails(): string[] {
  return validateAccessAllowedEmails(config.requireObject<string[]>("stagingAccessAllowedEmails"));
}

/**
 * The identity provider the human half of this door signs in with.
 *
 * Without one there is no human half at all: `allowedIdps` defaults to "all IdPs
 * configured in your account" (`zeroTrustAccessApplication.d.ts`), and a
 * read-only `GET /accounts/{id}/access/identity_providers` on 2026-09-08
 * answered `[]`. So an owner opening `staging.animichi.com` would have reached a
 * login page offering nothing to log in WITH, while the service token kept
 * working and every automated check stayed green.
 *
 * `onetimepin` because it needs no secret and no third-party app registration:
 * Cloudflare emails a code to the address, and the address is the identity the
 * `allow` policy already matches on. `type` is the provider's own enum value
 * (`ZeroTrustAccessIdentityProviderArgs.type`, "Available values: `onetimepin`,
 * `azureAD`, …"), and `config` is required but every one of its 30 members is
 * optional (`ZeroTrustAccessIdentityProviderConfig`, `types/input.d.ts`), which
 * is what makes the empty object the correct shape for a provider that takes no
 * parameters.
 *
 * **This is an ACCOUNT-level resource, not a staging one.** It lives on the
 * staging stack because staging is the only Access consumer this account has —
 * production has a real login and `topology-prod.test.ts` pins that it builds
 * nothing here. The day anything else in this account grows an Access
 * application, this belongs in a shared program, and leaving it here would mean
 * two stacks fighting over one account resource on every `pulumi up`.
 */
function oneTimePinProvider(): cloudflare.ZeroTrustAccessIdentityProvider {
  return new cloudflare.ZeroTrustAccessIdentityProvider("staging-onetimepin", {
    accountId,
    name: OTP_PROVIDER_NAME,
    type: "onetimepin",
    config: {},
  });
}

/** Service Auth: the token, and nothing else, gets in without an identity. */
function serviceAuthPolicy(token: cloudflare.ZeroTrustAccessServiceToken): cloudflare.ZeroTrustAccessPolicy {
  return new cloudflare.ZeroTrustAccessPolicy("staging-ci-service-auth", {
    accountId,
    name: "staging CI service token",
    decision: "nonIdentity",
    includes: [{ serviceToken: { tokenId: token.id } }],
  });
}

/** Identity: the named humans, after signing in with their identity provider. */
function ownerSignInPolicy(): cloudflare.ZeroTrustAccessPolicy {
  return new cloudflare.ZeroTrustAccessPolicy("staging-owner-sign-in", {
    accountId,
    name: "staging owners",
    decision: "allow",
    includes: allowedEmails().map((email) => ({ email: { email } })),
  });
}

/**
 * Both policies, in evaluation order.
 *
 * Service Auth first so automation is decided without ever being offered an
 * identity provider: `decision: "nonIdentity"` is the only action that answers
 * a service token, and an `allow` policy reached first would redirect the CD
 * smoke probe to a login page it cannot read (issue #1369, "policy action 必须
 * 是 Service Auth，否则 Access 会要求 IdP 登录").
 */
function attachedPolicies(token: cloudflare.ZeroTrustAccessServiceToken) {
  return [
    { id: serviceAuthPolicy(token).id, precedence: 1 },
    { id: ownerSignInPolicy().id, precedence: 2 },
  ];
}

function publishAccessApplication(token: cloudflare.ZeroTrustAccessServiceToken): void {
  const identityProvider = oneTimePinProvider();
  new cloudflare.ZeroTrustAccessApplication("staging", {
    accountId,
    name: APPLICATION_NAME,
    type: "self_hosted",
    domain: config.require("stagingDomain"),
    destinations: publicDestinations(),
    // Named, not defaulted. `allowedIdps` is an APPLICATION input — the policy
    // resource has no such member (`ZeroTrustAccessPolicyArgs`) — and the
    // policy-level equivalent, an `includes[].loginMethod` rule, would be wrong
    // here anyway: include rules are OR'd, so adding one beside the email rules
    // would admit anyone who completed an OTP, whatever their address.
    allowedIdps: [identityProvider.id],
    sessionDuration: SESSION_DURATION,
    // Nothing to advertise: every caller of staging knows the hostname it
    // wants, and an App Launcher tile only invites a click that ends in a deny.
    appLauncherVisible: false,
    policies: attachedPolicies(token),
  });
}

const stagingCiToken = stack === "staging" ? mintStagingCiToken() : undefined;
if (stagingCiToken !== undefined) publishAccessApplication(stagingCiToken);

// The two outputs below are the ESC environment's import source. Pulumi ESC's
// `pulumi-stacks` provider reads a stack's OUTPUTS by name, so the names are the
// contract: `lifeodyssey/animichi/staging` maps `stagingAccessClientId` →
// `CF_ACCESS_CLIENT_ID` and `stagingAccessClientSecret` → `CF_ACCESS_CLIENT_SECRET`
// under `environmentVariables`. Renaming either output silently empties the ESC
// keys, so `topology-staging.test.ts` pins both names.

/** The value Access checks in the `CF-Access-Client-Id` request header. */
export const stagingAccessClientId = stagingCiToken?.clientId;

/**
 * The value Access checks in the `CF-Access-Client-Secret` request header.
 *
 * Sealed explicitly. `AGENTS.md` states the cost of getting this wrong: an
 * unmarked value is written into Pulumi Cloud state in the clear and comes back
 * out in the clear in any operator `pulumi stack export`, and this repository is
 * public. The provider marks the attribute sensitive on its own; this asserts
 * the property rather than trusting one mechanism for it.
 */
export const stagingAccessClientSecret =
  stagingCiToken === undefined ? undefined : pulumi.secret(stagingCiToken.clientSecret);
