import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  FIXED_NOW,
  issuedToken,
  joseEnv,
  makeApp,
  post,
  productionEnv,
  testEnv,
} from "./migrate.worker.helpers";

// #1365 / #1055 — `policy.test.ts` proves the two allowlists judge claims
// correctly; this file proves the deployed Worker actually PICKS one. Without
// it `policyFor` could be dead code and every claims test would still pass,
// leaving the production Worker judging tokens by the staging allowlist.
//
// test-type: unit (HTTP seam; real jose verification against an injected JWKS).

const PRODUCTION_CLAIMS = {
  environment: "production",
  sub: "repo:lifeodyssey/animichi:environment:production",
};

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

/** An app that verifies against the injected JWKS with the env-selected policy. */
async function appForSignedClaims(claims: Record<string, unknown>) {
  const { token, jwk } = await issuedToken(claims);
  const { app } = await makeApp({ verifier: undefined, jwks: joseEnv(jwk) });
  return { app, token };
}

describe("the deployed Worker enforces the allowlist its environment selects", () => {
  it("admits the production deploy job when MIGRATOR_OIDC_POLICY is production", async () => {
    const { app, token } = await appForSignedClaims(PRODUCTION_CLAIMS);
    const res = await app.request(post({}, token), {}, productionEnv());
    expect(res.status).toBe(200);
  });

  it("refuses a valid staging token at the production Worker", async () => {
    const { app, token } = await appForSignedClaims({});
    const res = await app.request(post({}, token), {}, productionEnv());
    expect(res.status).toBe(403);
  });

  it("refuses a production token at a Worker with no selector", async () => {
    const { app, token } = await appForSignedClaims(PRODUCTION_CLAIMS);
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(403);
  });

  it("admits the staging deploy job at a Worker with no selector", async () => {
    const { app, token } = await appForSignedClaims({});
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(200);
  });
});
