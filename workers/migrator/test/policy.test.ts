import { describe, expect, it } from "vitest";
import {
  GITHUB_OIDC_ISSUER,
  enforceGitHubOidcAllowlist,
  type GitHubOidcClaims,
  type GitHubOidcPolicy,
} from "@animichi/contract/oidc-github";
import {
  MIGRATOR_OIDC_AUDIENCE,
  PRODUCTION_OIDC_POLICY,
  STAGING_OIDC_POLICY,
  TRUSTED_CD_WORKFLOW,
  policyFor,
} from "../src/policy";

// #1365 / #1055 — the migrator has two doors, and a token minted for one must
// never open the other. `refAnchored` is `refAllow.some(...)`, so the danger is
// not a weak rule but a merged allowlist: one array holding both the staging
// and the production shape accepts either token at either door (MED-2).
//
// test-type: unit (pure claims allowlist; no jose, no clock, no mocks).

const REPOSITORY = "lifeodyssey/animichi";

function makeStagingToken(overrides: Partial<GitHubOidcClaims> = {}): GitHubOidcClaims {
  return {
    iss: GITHUB_OIDC_ISSUER,
    aud: MIGRATOR_OIDC_AUDIENCE,
    repository: REPOSITORY,
    ref: "refs/heads/main",
    environment: "staging",
    job_workflow_ref: TRUSTED_CD_WORKFLOW,
    sub: `repo:${REPOSITORY}:environment:staging`,
    ...overrides,
  };
}

function makeProductionToken(overrides: Partial<GitHubOidcClaims> = {}): GitHubOidcClaims {
  return makeStagingToken({
    environment: "production",
    sub: `repo:${REPOSITORY}:environment:production`,
    ...overrides,
  });
}

function admits(policy: GitHubOidcPolicy, claims: GitHubOidcClaims): boolean {
  return enforceGitHubOidcAllowlist(claims, policy).ok;
}

describe("the production door", () => {
  it("admits the token the production deploy job carries", () => {
    expect(admits(PRODUCTION_OIDC_POLICY, makeProductionToken())).toBe(true);
  });

  it("refuses a token that carries no `environment: production` claim", () => {
    const claims = makeProductionToken({ environment: undefined, sub: `repo:${REPOSITORY}:ref:refs/heads/main` });
    expect(admits(PRODUCTION_OIDC_POLICY, claims)).toBe(false);
  });

  it("refuses a job_workflow_ref that is not cd.yml@refs/heads/main", () => {
    const claims = makeProductionToken({
      job_workflow_ref: `${REPOSITORY}/.github/workflows/cd.yml@refs/heads/attacker`,
    });
    expect(admits(PRODUCTION_OIDC_POLICY, claims)).toBe(false);
  });

  // The CONTROL of the matrix below, not a leak: an environment-scoped `sub` is
  // MED-2's second independently complete anchor, so GitHub minting it without
  // a separate `environment` claim is still a fully anchored production token.
  it("admits an environment-scoped sub with no environment claim (control: subAnchored)", () => {
    expect(admits(PRODUCTION_OIDC_POLICY, makeProductionToken({ environment: undefined }))).toBe(true);
  });
});

describe("cross-replay between the two doors", () => {
  it("refuses a valid staging token at the production door", () => {
    expect(admits(PRODUCTION_OIDC_POLICY, makeStagingToken())).toBe(false);
  });

  it("refuses a ref-form sub carrying no environment claim at either door", () => {
    const claims = makeStagingToken({
      environment: undefined,
      sub: `repo:${REPOSITORY}:ref:refs/heads/main`,
    });
    expect(admits(PRODUCTION_OIDC_POLICY, claims)).toBe(false);
    expect(admits(STAGING_OIDC_POLICY, claims)).toBe(false);
  });

  it("refuses a valid production token at the staging door", () => {
    expect(admits(STAGING_OIDC_POLICY, makeProductionToken())).toBe(false);
  });
});

function environmentsOf(policy: GitHubOidcPolicy): string[] {
  const fromRefs = policy.refAllow.map((shape) => shape.environment ?? "(any ref)");
  const fromSubs = policy.subAllow.map((sub) => sub.split(":").at(-1) ?? sub);
  return [...new Set([...fromRefs, ...fromSubs])].sort();
}

describe("the two allowlists stay apart", () => {
  // Merging them is the one mutation the cross-replay cases above cannot see:
  // every individual rule still reads correctly, and both tokens pass both doors.
  it("never lets one allowlist carry both environment shapes", () => {
    expect(environmentsOf(STAGING_OIDC_POLICY)).toEqual(["staging"]);
    expect(environmentsOf(PRODUCTION_OIDC_POLICY)).toEqual(["production"]);
  });

  it("selects production only on the explicit selector, staging otherwise", () => {
    expect(policyFor("production")).toBe(PRODUCTION_OIDC_POLICY);
    expect(policyFor("staging")).toBe(STAGING_OIDC_POLICY);
    expect(policyFor(undefined)).toBe(STAGING_OIDC_POLICY);
  });
});
