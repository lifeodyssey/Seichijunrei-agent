import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { GITHUB_OIDC_ISSUER, createGitHubOidcVerifier } from "@animichi/contract/oidc-github";
import {
  MIGRATOR_OIDC_AUDIENCE,
  TRUSTED_CD_WORKFLOW,
} from "../src/policy";
import {
  FIXED_NOW,
  issuedToken,
  joseEnv,
  makeApp,
  policy,
  post,
  testEnv,
  type ContainerOutcome,
} from "./migrate.worker.helpers";

// #1051 — migrator HTTP-seam identity tests: valid identity, invalid
// identities (wrong repo / audience / expired), and request guards. The
// container only runs once the identity is anchored per the allowlist.

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("POST /migrate — valid identity", () => {
  it("returns success with the applied head when the container exits 0", async () => {
    const { app, token } = await makeApp();
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      exitCode: 0,
      appliedHead: "20260814191301_turn_idempotency_outbox",
      pathVerification: "verified",
    });
  });

  it("injects the migrator DSN into the container run", async () => {
    let seenDsn: string | undefined;
    const { app, token } = await makeApp({
      runContainer: (dsn: string): Promise<ContainerOutcome> => {
        seenDsn = dsn;
        return Promise.resolve({ kind: "success", exitCode: 0 });
      },
    });
    await app.request(post({}, token), {}, testEnv());
    expect(seenDsn).toBe("postgresql://fake:migrator@db.test/neondb");
  });
});

describe("POST /migrate — invalid identities", () => {
  it("rejects a token from the wrong repository with 403", async () => {
    const { token, jwk } = await issuedToken({ repository: "attacker/other" });
    const { app } = await makeApp({ verifier: createGitHubOidcVerifier(policy, joseEnv(jwk)) });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(403);
  });

  it("rejects a token minted for another audience with 403", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk2 = { ...(await exportJWK(publicKey)), kid: "other" } as JWK;
    const wrongAudToken = await new SignJWT({
      repository: "lifeodyssey/animichi",
      ref: "refs/heads/main",
      environment: "staging",
      workflow_ref: TRUSTED_CD_WORKFLOW,
    })
      .setProtectedHeader({ alg: "RS256", kid: "other", typ: "JWT" })
      .setIssuer(GITHUB_OIDC_ISSUER)
      .setAudience("some-other-audience")
      .setExpirationTime("5m")
      .sign(privateKey);
    const { app } = await makeApp({ verifier: createGitHubOidcVerifier(policy, joseEnv(jwk2)) });
    const res = await app.request(post({}, wrongAudToken), {}, testEnv());
    expect(res.status).toBe(403);
  });

  it("rejects an expired token with 403", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "expired" } as JWK;
    const expiredToken = await new SignJWT({
      repository: "lifeodyssey/animichi",
      ref: "refs/heads/main",
      environment: "staging",
      workflow_ref: TRUSTED_CD_WORKFLOW,
    })
      .setProtectedHeader({ alg: "RS256", kid: "expired", typ: "JWT" })
      .setIssuer(GITHUB_OIDC_ISSUER)
      .setAudience(MIGRATOR_OIDC_AUDIENCE)
      .setExpirationTime(Math.floor(FIXED_NOW.getTime() / 1000) - 60)
      .sign(privateKey);
    const { app } = await makeApp({ verifier: createGitHubOidcVerifier(policy, joseEnv(jwk)) });
    const res = await app.request(post({}, expiredToken), {}, testEnv());
    expect(res.status).toBe(403);
  });
});

describe("POST /migrate — request guards", () => {
  it("answers 401 when no bearer token is supplied", async () => {
    const { app } = await makeApp();
    const res = await app.request(post({}, ""), {}, testEnv());
    expect(res.status).toBe(401);
  });

  it("rejects a missing/invalid JSON body as a 400", async () => {
    const { app, token } = await makeApp();
    const res = await app.request(
      new Request("https://migrator.test/migrate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: "{ invalid",
      }),
      {},
      testEnv(),
    );
    expect(res.status).toBe(400);
  });
});
