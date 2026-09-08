/**
 * #1051 — the migrator worker's OIDC policy (GitHub Actions trigger).
 *
 * Per-environment-anchored claims allowlist (MED-2, issue #1051 amendment):
 * staging accepts only ref == refs/heads/main AND environment == staging.
 * The audience is a fixed project-specific value, so a token minted for any
 * other door in this account is rejected here rather than cross-accepted.
 *
 * #1365 adds PRODUCTION as a SEPARATE allowlist, never extra shapes appended
 * to the staging one: `refAnchored` is `policy.refAllow.some(...)`
 * (`oidc-github.ts:77-83`), so one allowlist holding both shapes would let a
 * token minted by the staging job walk through the production door. MED-2
 * forbids exactly that. The two policies are selected per deployed Worker by
 * the `MIGRATOR_OIDC_POLICY` var, which is how they stay apart at runtime.
 */

import { GITHUB_OIDC_ISSUER, type GitHubOidcPolicy } from "@animichi/contract/oidc-github";

/**
 * Fixed migrator OIDC audience (stem: `animichi:github-actions:migrator`).
 * CI requests it via ACTIONS_ID_TOKEN_REQUEST_URL?audience=... and GitHub
 * mints the token with this aud. It is the only OIDC door this repository
 * verifies for itself — the staging one it used to be paired against was
 * deleted with #1369, when Cloudflare Access took that job — so the audience
 * earns its specificity against every OTHER consumer of a GitHub OIDC token in
 * this account, not against a sibling in this tree.
 */
export const MIGRATOR_OIDC_AUDIENCE = "animichi:github-actions:migrator";

/**
 * Only the main-only CD workflow may present a token.
 */
export const TRUSTED_CD_WORKFLOW =
  "lifeodyssey/animichi/.github/workflows/cd.yml@refs/heads/main";

/** GitHub Actions OIDC JWKS (constructor-injected elsewhere; production source). */
export const GITHUB_OIDC_JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";

/** The staging claims allowlist. */
export const STAGING_OIDC_POLICY: GitHubOidcPolicy = {
  issuer: GITHUB_OIDC_ISSUER,
  audience: MIGRATOR_OIDC_AUDIENCE,
  repository: "lifeodyssey/animichi",
  refAllow: [{ ref: "refs/heads/main", environment: "staging" }],
  subAllow: [],
  trustedWorkflowRefs: [TRUSTED_CD_WORKFLOW],
};

/**
 * The production claims allowlist (#1365 / #1055). Two independently complete
 * anchors, per MED-2: the ref+environment pair, or the environment-scoped
 * `sub` GitHub mints for a job running in the `production` environment.
 * Nothing staging-shaped may ever be added here, and nothing here may ever be
 * added to STAGING_OIDC_POLICY.
 */
export const PRODUCTION_OIDC_POLICY: GitHubOidcPolicy = {
  issuer: GITHUB_OIDC_ISSUER,
  audience: MIGRATOR_OIDC_AUDIENCE,
  repository: "lifeodyssey/animichi",
  refAllow: [{ ref: "refs/heads/main", environment: "production" }],
  subAllow: ["repo:lifeodyssey/animichi:environment:production"],
  trustedWorkflowRefs: [TRUSTED_CD_WORKFLOW],
};

/** The `[env.production]` var that selects the production allowlist. */
export const PRODUCTION_POLICY_SELECTOR = "production";

/**
 * Pick the allowlist this deployed Worker enforces. Staging is the default so
 * a Worker deployed with no selector at all cannot accidentally become the
 * production door; only the explicit selector opens it.
 */
export function policyFor(selector: string | undefined): GitHubOidcPolicy {
  return selector === PRODUCTION_POLICY_SELECTOR ? PRODUCTION_OIDC_POLICY : STAGING_OIDC_POLICY;
}
