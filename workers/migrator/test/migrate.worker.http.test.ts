import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXED_NOW, makeApp, post, testEnv } from "./migrate.worker.helpers";
import { FakeSql } from "./fake-sql";
import { BODY_B, HEAD_B, workerHttpDeps } from "./http-apply.helpers";

// #1124 AC5 + extra — HTTP seam is OIDC + strict selected artifact metadata only;
// POST /migrate with expectedHead matching the applied chain returns 200.

const DROP_SQL = "DROP TABLE public.bangumi;";

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("POST /migrate HTTP seam (AC5)", () => {
  it("rejects raw SQL and down-migration fields before applying", async () => {
    const db = new FakeSql();
    const { app, token } = await makeApp(workerHttpDeps(db));
    const res = await app.request(
      post({ sql: DROP_SQL, down: true, migration: DROP_SQL }, token),
      {},
      testEnv(),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(db.units)).not.toContain("DROP TABLE");
    expect(JSON.stringify(db.units)).not.toContain("public.bangumi");
  });

  it("rejects an empty JSON object body", async () => {
    const db = new FakeSql();
    const { app, token } = await makeApp(workerHttpDeps(db));
    const res = await app.request(
      new Request("https://migrator.test/migrate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: "{}",
      }),
      {},
      testEnv(),
    );
    expect(res.status).toBe(400);
    expect(db.units).toHaveLength(0);
  });
});

describe("POST /migrate HTTP apply default", () => {
  it("fails closed when the apply lock binding is missing", async () => {
    const { app, token } = await makeApp({ runContainer: undefined });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "migration_unavailable" });
  });
});

describe("POST /migrate HTTP apply SQL error", () => {
  it("returns a stable code on a failed SQL apply", async () => {
    const db = new FakeSql();
    db.failBody = BODY_B;
    const { app, token } = await makeApp(workerHttpDeps(db));
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      exitCode: 1,
      appliedHead: null,
      error: "migration_failed",
    });
  });
});

describe("POST /migrate HTTP apply (expectedHead)", () => {
  it("returns 200 and appliedHead equal to expected when the chain matches", async () => {
    const db = new FakeSql();
    const { app, token } = await makeApp(workerHttpDeps(db));
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      exitCode: 0,
      appliedHead: HEAD_B,
      pathVerification: "verified",
    });
  });
});

// #1339 (ucm-H2): `GET /ledger-head` reported the applied head to anyone, and
// resolved the DDL-capable migrator DSN on every anonymous hit of a public
// `workers_dev` host. The head is now readable only from this OIDC-gated
// response, so both halves are pinned: the route stays absent, and the
// missing-DSN branch that survived the deletion still answers 503.
describe("migrator HTTP surface", () => {
  it("does not route GET /ledger-head", async () => {
    const { app } = await makeApp();
    const res = await app.request("https://migrator.test/ledger-head", {}, testEnv());
    expect(res.status).toBe(404);
  });

  it("answers 503 on POST /migrate when the migrator DSN is not configured", async () => {
    const { app, token } = await makeApp();
    const res = await app.request(post({}, token), {}, {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "migrator database not configured" });
  });
});
