import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXED_NOW, makeApp, post, testEnv } from "./migrate.worker.helpers";
import { FakeSql } from "./fake-sql";
import { applyFixture, BODY_A, BODY_B, HEAD_A, HEAD_B, workerHttpDeps } from "./http-apply.helpers";

// CodeRabbit on #1471 — the handshake admits an `expectedHead` of A from an A→B
// bundle (membership, not equality), and the apply then walked EVERY pending
// file: an A request advanced the database to B, and the head check in
// `migration.ts` only failed afterwards, with the schema already moved. The
// apply now stops at the head the caller asked for, and refuses a request the
// ledger already stands past.
//
// test-type: unit (HTTP seam; injected chain + JWKS, the real apply over a fake
// neon-http client, so what is asserted is the SQL that reached the database).

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("POST /migrate stops at the head the caller asked for", () => {
  it("applies the file that head names", async () => {
    const db = new FakeSql();
    const { app, token } = await makeApp(workerHttpDeps(db));
    const res = await app.request(post({ expectedHead: HEAD_A }, token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, appliedHead: HEAD_A });
  });

  it("leaves the newer file of the same bundle unapplied", async () => {
    const db = new FakeSql();
    const { app, token } = await makeApp(workerHttpDeps(db));
    await app.request(post({ expectedHead: HEAD_A }, token), {}, testEnv());
    expect(db.committed).toEqual([BODY_A]);
    expect(db.units).not.toContain(BODY_B);
  });

  it("still applies the whole bundle when that head is what was asked for", async () => {
    const db = new FakeSql();
    const { app, token } = await makeApp(workerHttpDeps(db));
    const res = await app.request(post({ expectedHead: HEAD_B }, token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(db.committed).toEqual([BODY_A, BODY_B]);
  });
});

describe("POST /migrate against a ledger already at that head", () => {
  it("applies nothing a second time and still answers success", async () => {
    const db = new FakeSql();
    const { app, token } = await makeApp(workerHttpDeps(db));
    await app.request(post({ expectedHead: HEAD_A }, token), {}, testEnv());
    const res = await app.request(post({ expectedHead: HEAD_A }, token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(db.committed).toEqual([BODY_A]);
  });
});

describe("POST /migrate against a ledger past that head", () => {
  it("refuses with 422 and names the applied version", async () => {
    const db = new FakeSql();
    const { app, token } = await makeApp(workerHttpDeps(db));
    await app.request(post({ expectedHead: HEAD_B }, token), {}, testEnv());
    const res = await app.request(post({ expectedHead: HEAD_A }, token), {}, testEnv());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      success: false,
      appliedHead: null,
      error: "applied version 20260814191301 is not reached by expected head 20260811000001_turn_outcome",
    });
  });

  it("applies nothing on that refusal", async () => {
    const db = new FakeSql();
    const { app, token } = await makeApp(workerHttpDeps(db));
    await app.request(post({ expectedHead: HEAD_B }, token), {}, testEnv());
    await app.request(post({ expectedHead: HEAD_A }, token), {}, testEnv());
    expect(db.committed).toEqual([BODY_A, BODY_B]);
  });
});

// The handshake answers 409 for a head the bundle cannot reach, so this guard is
// unreachable through the Worker; it is asserted at the apply itself, which the
// apply-lock Durable Object also calls directly.
describe("the apply refuses a head its chain does not carry", () => {
  it("returns a refusal without touching the schema", async () => {
    const db = new FakeSql();
    const outcome = await applyFixture(db, { expectedHead: "20261231000000_not_bundled" });
    expect(outcome).toEqual({
      kind: "refused",
      reason: "bundled chain cannot reach expected head 20261231000000_not_bundled",
    });
    expect(db.units).toEqual([]);
  });
});
