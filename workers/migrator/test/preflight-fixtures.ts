import { vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import atlasSum from "./fixtures/preflight-chain/atlas.sum";
import { createMigratorApp } from "../src/create-app";
import { mapSource } from "../src/chain";
import { joseEnv, testEnv } from "./migrate.worker.helpers";
import { GITHUB_OIDC_ISSUER } from "@animichi/contract/oidc-github";
import { MIGRATOR_OIDC_AUDIENCE, TRUSTED_CD_WORKFLOW } from "../src/policy";

export const HEAD_A = "20260101000000_baseline";
export const HEAD_B = "20260102000000_extend";
export const HASH_A = "GyYyU4QwpVjgdMV7iRCqOFveqf9MIv1fKydRRneHOpU=";
export const HASH_B = "LKQVM73xJ2Ey73k0KPocejIyZWurr2VryBKFNu7xsow=";
export const metadata = { expectedHead: HEAD_B, atlasSum, stagingOnlyBaseline: false };
export const COLUMN_NAMES = ["version", "description", "type", "applied", "total", "hash", "error"];

export interface RevisionFixture {
  version: string;
  description: string;
  type: string;
  applied: string;
  total: string;
  hash: string;
  error: string | null;
}

export function revision(patch: Partial<RevisionFixture> = {}): RevisionFixture {
  return { version: "20260101000000", description: "baseline", type: "2", applied: "1", total: "1", hash: HASH_A, error: null, ...patch };
}

export function nativeResult(rows: readonly RevisionFixture[]): Response {
  const result = { fields: COLUMN_NAMES.map((name) => ({ name, dataTypeID: 25 })), rows: rows.map(Object.values) };
  return Response.json({ results: [result] });
}

export function serveLedger(rows: readonly RevisionFixture[]) {
  const transport = vi.fn<typeof fetch>(() => Promise.resolve(nativeResult(rows)));
  vi.stubGlobal("fetch", transport);
  return transport;
}

export function preflightRequest(body: unknown, token: string): Request {
  return new Request("https://migrator.test/preflight", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function signedApp(claims: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: "preflight-test" };
  const token = await new SignJWT({ repository: "lifeodyssey/animichi", ref: "refs/heads/main",
    environment: "staging", sub: "repo:lifeodyssey/animichi:environment:staging",
    workflow_ref: TRUSTED_CD_WORKFLOW, iss: GITHUB_OIDC_ISSUER, aud: MIGRATOR_OIDC_AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 300, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "preflight-test" }).sign(privateKey);
  const chain = mapSource("h1:old\n20251201000000_old.sql h1:old\n", { "20251201000000_old.sql": "" });
  return { token, app: createMigratorApp({ jwks: joseEnv(jwk), chain }), env: testEnv() };
}
