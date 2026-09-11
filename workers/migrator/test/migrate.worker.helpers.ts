import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import {
  GITHUB_OIDC_ISSUER,
  createGitHubOidcVerifier,
  type GitHubOidcPolicy,
} from "@animichi/contract/oidc-github";
import { createMigratorApp, type Env as MigratorEnv, type MigratorDeps } from "../src/create-app";
import type { ContainerOutcome } from "../src/migration";
import {
  MIGRATOR_OIDC_AUDIENCE,
  TRUSTED_CD_WORKFLOW,
} from "../src/policy";
import { fixtureChain, HEAD_A, HEAD_B } from "./http-apply.helpers";

// #1051 — shared HTTP-seam fixtures for the migrator worker tests: faked
// container binding + injected JWKS (spec §Testing Decisions 1). jose resolves
// exp against the wall clock, so the clock is pinned to a fixed instant.
export const FIXED_NOW = new Date("2026-03-01T00:00:00.000Z");

export type { ContainerOutcome };

const DSN = "postgresql://fake:migrator@db.test/neondb";

export const policy: GitHubOidcPolicy = {
  issuer: GITHUB_OIDC_ISSUER,
  audience: MIGRATOR_OIDC_AUDIENCE,
  repository: "lifeodyssey/animichi",
  refAllow: [{ ref: "refs/heads/main", environment: "staging" }],
  subAllow: [],
  trustedWorkflowRefs: [TRUSTED_CD_WORKFLOW],
};

export function testEnv(): MigratorEnv {
  return { ENVIRONMENT: "staging", MIGRATOR_DATABASE_URL: DSN } as MigratorEnv;
}

// #1365 — the production deployment differs from staging by exactly this var
// (workers/migrator/wrangler.toml `[env.production]`); it is what makes the
// Worker enforce PRODUCTION_OIDC_POLICY instead of the staging allowlist.
export function productionEnv(): MigratorEnv {
  return {
    ENVIRONMENT: "production",
    MIGRATOR_OIDC_POLICY: "production",
    MIGRATOR_DATABASE_URL: DSN,
  } as MigratorEnv;
}

export async function issuedToken(overrides: Record<string, unknown> = {}): Promise<{
  token: string;
  jwk: JWK;
  privateKey: CryptoKey;
}> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "migrator-test-key" } as JWK;
  const token = await new SignJWT({
    repository: "lifeodyssey/animichi",
    ref: "refs/heads/main",
    environment: "staging",
    workflow_ref: TRUSTED_CD_WORKFLOW,
    sub: "repo:lifeodyssey/animichi:environment:staging",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "migrator-test-key", typ: "JWT" })
    .setIssuer(GITHUB_OIDC_ISSUER)
    .setAudience(MIGRATOR_OIDC_AUDIENCE)
    .setExpirationTime("5m")
    .sign(privateKey);
  return { token, jwk, privateKey };
}

export function joseEnv(jwk: JWK) {
  return createLocalJWKSet({ keys: [jwk] });
}

// The app under test carries the fixture chain (`http-apply.helpers`), not the
// repository's own `migrations/neon` bundle: these tests are about the HTTP
// seam, and the #1365 handshake answers `/healthz` and the 409 from whichever
// chain the Worker carries. Its head is HEAD_B — the head `post()` expects.
export async function makeApp(overrides: Partial<MigratorDeps> = {}) {
  const { token, jwk } = await issuedToken();
  const deps: MigratorDeps = {
    chain: fixtureChain,
    verifier: createGitHubOidcVerifier(policy, joseEnv(jwk)),
    runContainer: (): Promise<ContainerOutcome> => Promise.resolve({ kind: "success", exitCode: 0 }),
    readAppliedHead: (): Promise<string | null> => Promise.resolve("20260814191301_turn_idempotency_outbox"),
    ...overrides,
  };
  return { app: createMigratorApp(deps), token };
}

export function post(body: Record<string, unknown>, token: string): Request {
  return new Request("https://migrator.test/migrate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ expectedHead: HEAD_B, atlasSum: requestedSum(body.expectedHead), stagingOnlyBaseline: false, ...body }),
  });
}

/** Native Atlas v0.30.0 fixture checksums, including the cumulative A-only directory. */
function requestedSum(head: unknown): string {
  if (head === HEAD_A) return "h1:WggkOYIHPi39gCs0atYwAl9FWP+l8eSKywqBfcVybl4=\n20260811000001_turn_outcome.sql h1:kDkRLCxK9e7se3NrHdn0RSlV4npGr8xO++D3MwUX03I=\n";
  return fixtureChain.atlasSum().replace(HEAD_B, typeof head === "string" ? head : HEAD_B);
}
