import { describe, expect, it, vi } from "vitest";
import { issuedToken, joseEnv, makeApp, post, productionEnv, testEnv } from "./migrate.worker.helpers";

import type { ContainerOutcome } from "../src/migration";
import type { PreflightMetadata } from "../src/preflight-metadata";
import { HEAD_B } from "./http-apply.helpers";

describe("selected migration metadata", () => {
  it("refuses an empty object before reading credentials or applying", async () => {
    const { app, token } = await makeApp();
    const get = (): Promise<string> => { throw new Error("credentials must remain closed"); };
    const response = await app.request("https://migrator.test/migrate", {
      method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}",
    }, { ...testEnv(), MIGRATOR_DATABASE_URL: { get } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_migration" });
  });
  it("sanitizes a Secrets Store resolution failure after accepting metadata", async () => {
    const { app, token } = await makeApp();
    const get = (): Promise<string> => Promise.reject(new Error("password=fixture"));
    const response = await app.request(post({}, token), undefined, { ...testEnv(), MIGRATOR_DATABASE_URL: { get } });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: "migration_unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("keeps database errors out of the failure response", async () => {
    const { app, token } = await makeApp({ runContainer: () => Promise.resolve({ kind: "failure", exitCode: 1, error: "password=fixture" }) });
    const response = await app.request(post({}, token), undefined, testEnv());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, exitCode: 1, appliedHead: null, error: "migration_failed" });
  });
});


describe("selected metadata at the public HTTP boundary", () => {
  it("rejects a staging-only baseline at the correctly authenticated production worker", async () => {
    const { token, jwk } = await issuedToken({ environment: "production", sub: "repo:lifeodyssey/animichi:environment:production" });
    const { app } = await makeApp({ verifier: undefined, jwks: joseEnv(jwk) });
    const get = (): Promise<string> => { throw new Error("credentials must remain closed"); };
    const response = await app.request(post({ stagingOnlyBaseline: true }, token), undefined,
      { ...productionEnv(), MIGRATOR_DATABASE_URL: { get } });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "staging_only_baseline" });
  });

  it("rejects an oversized metadata body before credentials", async () => {
    const { app, token } = await makeApp();
    const get = (): Promise<string> => { throw new Error("credentials must remain closed"); };
    const response = await app.request(post({ atlasSum: "a".repeat(65_536) }, token), undefined,
      { ...testEnv(), MIGRATOR_DATABASE_URL: { get } });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "invalid_migration" });
  });

  it("forwards the complete parsed selection through the default DO binding", async () => {
    const run = vi.fn<(dsn: string, metadata: PreflightMetadata) => Promise<ContainerOutcome>>()
      .mockResolvedValue({ kind: "success", exitCode: 0 });
    const namespace = { idFromName: () => "fixed-id", get: () => ({ run }) } as unknown as DurableObjectNamespace;
    const { app, token } = await makeApp({ runContainer: undefined });
    const response = await app.request(post({}, token), undefined, { ...testEnv(), MIGRATOR_APPLY_LOCK: namespace });
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith("postgresql://fake:migrator@db.test/neondb", {
      expectedHead: HEAD_B, stagingOnlyBaseline: false, entries: [
        { version: "20260811000001", description: "turn_outcome", hash: "kDkRLCxK9e7se3NrHdn0RSlV4npGr8xO++D3MwUX03I=" },
        { version: "20260814191301", description: "turn_idempotency_outbox", hash: "u/xj/M3EYcEEYEo+F0WyZr7Cq2vX7ZAzDNNi3jhnQCo=" },
      ],
    });
  });
});
