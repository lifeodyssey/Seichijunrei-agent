import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  FIXED_NOW,
  makeApp,
  post,
  testEnv,
  type ContainerOutcome,
} from "./migrate.worker.helpers";
import { HEAD_A, HEAD_B } from "./http-apply.helpers";

// #1365 (closes #1332) — `wrangler deploy` returning is not the new bundle
// serving. The caller learns which chain is actually live from `/healthz`, and
// a head the live bundle cannot reach is refused with 409 `stale_bundle`
// BEFORE the Worker resolves a DSN or runs anything.
//
// test-type: unit (HTTP seam; injected chain, container and JWKS).

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("GET /healthz publishes the carried bundle", () => {
  it("reports the last head of the chain this Worker carries", async () => {
    const { app } = await makeApp();
    const res = await app.request("https://migrator.test/healthz", {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      service: "migrator",
      env: "staging",
      bundleHead: HEAD_B,
    });
  });
});

describe("POST /migrate refuses a head the bundle cannot reach", () => {
  it("answers 409 stale_bundle naming the head it does carry", async () => {
    const { app, token } = await makeApp();
    const res = await app.request(post({ expectedHead: "20261231000000_not_bundled" }, token), {}, testEnv());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stale_bundle", bundleHead: HEAD_B });
  });

  it("refuses before touching the database, so a missing DSN is not what answers", async () => {
    const { app, token } = await makeApp();
    const res = await app.request(post({ expectedHead: "20261231000000_not_bundled" }, token), {}, {});
    expect(res.status).toBe(409);
  });

  it("never starts the apply for a stale head", async () => {
    let started = false;
    const { app, token } = await makeApp({
      runContainer: (): Promise<ContainerOutcome> => {
        started = true;
        return Promise.resolve({ kind: "success", exitCode: 0 });
      },
    });
    await app.request(post({ expectedHead: "20261231000000_not_bundled" }, token), {}, testEnv());
    expect(started).toBe(false);
  });

  // Membership, not equality: a re-run of an already-applied head is a legal
  // request, and the poll only has to wait for the head to become REACHABLE.
  it("accepts an earlier head the bundle still carries", async () => {
    const { app, token } = await makeApp({
      readAppliedHead: (): Promise<string | null> => Promise.resolve(HEAD_A),
    });
    const res = await app.request(post({ expectedHead: HEAD_A }, token), {}, testEnv());
    expect(res.status).toBe(200);
  });

  it("still applies when the caller sends no expectedHead at all", async () => {
    const { app, token } = await makeApp();
    const res = await app.request(post({ expectedHead: undefined }, token), {}, testEnv());
    expect(res.status).toBe(200);
  });
});
