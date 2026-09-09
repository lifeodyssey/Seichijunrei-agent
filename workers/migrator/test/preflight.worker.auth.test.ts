import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMigratorApp } from "../src/create-app";
import { FIXED_NOW, productionEnv, testEnv } from "./migrate.worker.helpers";
import { metadata, preflightRequest, revision, serveLedger, signedApp } from "./preflight-fixtures";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("refuses an anonymous preflight before resolving the database secret", async () => {
  const get = vi.fn(() => Promise.resolve("postgresql://private:secret@db.test/private"));
  const env = { ...testEnv(), MIGRATOR_DATABASE_URL: { get } };
  const response = await createMigratorApp().request("/preflight", { method: "POST" }, env);
  expect(response.status).toBe(401);
  expect(get).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it.each([
  ["issuer", { iss: "https://attacker.test" }],
  ["audience", { aud: "other-service" }],
  ["repository", { repository: "outsider/animichi" }],
  ["environment", { environment: "production" }],
  ["ref", { ref: "refs/heads/feature" }],
  ["caller", { workflow_ref: "lifeodyssey/animichi/.github/workflows/pr.yml@refs/heads/main" }],
  ["callee", { job_workflow_ref: "outsider/animichi/.github/workflows/cd.yml@refs/heads/main" }],
  ["missing workflow", { workflow_ref: undefined }],
  ["expired", { exp: 1 }],
  ["future", { nbf: 9_999_999_999 }],
])("refuses a signed token with wrong %s before secret or SQL", async (_name, claims) => {
  const { app, token, env } = await signedApp(claims);
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const transport = serveLedger([revision()]);
  const response = await app.request(preflightRequest(metadata, token), undefined,
    { ...env, MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "forbidden" });
  expect(get).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it("rejects an invalid signature before secret reads", async () => {
  const { app, env } = await signedApp();
  const { token } = await signedApp();
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const response = await app.request(preflightRequest(metadata, token), undefined,
    { ...env, MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBe(403);
  expect(get).not.toHaveBeenCalled();
});

it.each([
  { environment: "production", sub: "repo:lifeodyssey/animichi:environment:production" },
  { environment: undefined, sub: "repo:lifeodyssey/animichi:environment:production" },
])("accepts legitimate production claims $environment with main independently present", async (claims) => {
  serveLedger([revision()]);
  const { app, token } = await signedApp(claims);
  const response = await app.request(preflightRequest(metadata, token), undefined, productionEnv());
  expect(response.status).toBe(200);
});

it.each(["refs/heads/feature", undefined])("refuses production subject with ref %s", async (ref) => {
  const { app, token } = await signedApp({ environment: undefined, ref,
    sub: "repo:lifeodyssey/animichi:environment:production" });
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const response = await app.request(preflightRequest(metadata, token), undefined,
    { ...productionEnv(), MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBe(403);
  expect(get).not.toHaveBeenCalled();
});

it("refuses a staging token at the production endpoint before secret reads", async () => {
  const { app, token } = await signedApp();
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const response = await app.request(preflightRequest(metadata, token), undefined,
    { ...productionEnv(), MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBe(403);
  expect(get).not.toHaveBeenCalled();
});
