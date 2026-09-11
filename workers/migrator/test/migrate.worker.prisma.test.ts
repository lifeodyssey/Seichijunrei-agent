import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FIXED_NOW, issuedToken, joseEnv, makeApp, post, testEnv } from "./migrate.worker.helpers";
import { metadata, preflightRequest, signedApp } from "./preflight-fixtures";
import { MIGRATIONS, requestMetadata } from "./integration/prisma-fixture";
import { createMigratorApp } from "../src/create-app";
import { PRISMA_TARGET } from "../src/prisma-target";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW }));
afterEach(() => vi.useRealTimers());

it("advertises the native contract target carried by the serving bundle without a DSN", async () => {
  const { app } = await makeApp();
  const response = await app.request("https://migrator.test/healthz", {}, {});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ prismaTarget: PRISMA_TARGET });
});

it("refuses an unavailable Prisma target before resolving the privileged DSN", async () => {
  const { app, token } = await signedApp();
  const response = await app.request(preflightRequest({ ...metadata, expectedPrismaRef: "f".repeat(64) }, token), {}, {});
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "stale_prisma_bundle", prismaTarget: PRISMA_TARGET });
});

it("refuses apply for an unavailable native snapshot before database configuration", async () => {
  const { app, token } = await makeApp({ migrationsDir: MIGRATIONS });
  const response = await app.request(post({ ...requestMetadata, expectedPrismaRef: "f".repeat(64) }, token), {}, {});
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "stale_prisma_bundle", prismaTarget: PRISMA_TARGET });
});

it("refuses a staging-only native baseline in production before database configuration", async () => {
  const { jwk, token } = await issuedToken({ environment: "production", sub: "repo:lifeodyssey/animichi:environment:production" });
  const app = createMigratorApp({ jwks: joseEnv(jwk), migrationsDir: MIGRATIONS });
  const response = await app.request(post({ ...requestMetadata, stagingOnlyBaseline: true }, token), {}, {
    MIGRATOR_OIDC_POLICY: "production",
  });
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "staging_only_baseline" });
});

it("refuses native preview when its shared apply lock is unconfigured", async () => {
  const { app, token } = await makeApp({ migrationsDir: MIGRATIONS });
  const response = await app.request(preflightRequest(requestMetadata, token), {}, testEnv());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "preflight_unavailable" });
});
