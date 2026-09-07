import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  FIXED_NOW,
  makeApp,
  post,
  testEnv,
  type ContainerOutcome,
} from "./migrate.worker.helpers";
import { HEAD_B } from "./http-apply.helpers";

// #1051 — migrator HTTP-seam container-outcome tests: exit-code mapping, the
// hung-container 504, the empty-ledger null head, and the health probe.

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("POST /migrate — container exit + error mapping", () => {
  it("reports a non-zero container exit as a failure response", async () => {
    const { app, token } = await makeApp({
      runContainer: (): Promise<ContainerOutcome> => Promise.resolve({ kind: "failure", exitCode: 3 }),
    });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, exitCode: 3, appliedHead: null });
  });

  it("returns success with a null applied head when the ledger has no revisions row", async () => {
    const { app, token } = await makeApp({
      readAppliedHead: (): Promise<string | null> => Promise.resolve(null),
    });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      exitCode: 0,
      appliedHead: null,
      pathVerification: "verified",
    });
  });

  it("surfaces an unexpected orchestration throw as a 500 with the error message (#1091 US-27)", async () => {
    const { app, token } = await makeApp({
      runContainer: (): Promise<ContainerOutcome> =>
        Promise.reject(new Error("container start failed: image not found")),
    });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "container start failed: image not found" });
  });
});

function unknownExitLedger(before: string | null, after: string | null) {
  let head = before;
  return {
    runContainer: (): Promise<ContainerOutcome> => {
      head = after;
      return Promise.resolve({ kind: "unknown_exit" });
    },
    readAppliedHead: (): Promise<string | null> => Promise.resolve(head),
  };
}

describe("POST /migrate — unknown-exit ledger judgment", () => {
  it("returns unverified success when unknown_exit leaves the ledger at expectedHead", async () => {
    const { app, token } = await makeApp(
      unknownExitLedger("20260814191301_turn_idempotency_outbox", "20260814191301_turn_idempotency_outbox"),
    );
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      exitCode: 0,
      appliedHead: "20260814191301_turn_idempotency_outbox",
      pathVerification: "unverified",
    });
  });

  it("returns verified success when unknown_exit advances the ledger to expectedHead", async () => {
    const { app, token } = await makeApp(
      unknownExitLedger("20260811000001_turn_outcome", "20260814191301_turn_idempotency_outbox"),
    );
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      exitCode: 0,
      appliedHead: "20260814191301_turn_idempotency_outbox",
      pathVerification: "verified",
    });
  });

  it("returns failure with applied and expected heads when a stop without exit code mismatches the ledger", async () => {
    const { app, token } = await makeApp({
      runContainer: (): Promise<ContainerOutcome> => Promise.resolve({ kind: "unknown_exit" }),
      readAppliedHead: (): Promise<string | null> => Promise.resolve("20260811000001_turn_outcome"),
    });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      exitCode: 1,
      appliedHead: "20260811000001_turn_outcome",
      error: "applied head 20260811000001_turn_outcome does not equal expected head 20260814191301_turn_idempotency_outbox",
    });
  });
});

describe("POST /migrate — timeout 504 body (#1101)", () => {
  // #1101 AC5: a timeout 504 carries ranMs + lastStatus (+ exitCode when the
  // state had one) and NEVER leaks the DSN; the HTTP status stays 504.
  it("answers 504 with ranMs + lastStatus and no DSN when the container hangs past the timeout", async () => {
    const { app, token } = await makeApp({
      runContainer: (): Promise<ContainerOutcome> =>
        Promise.resolve({ kind: "timeout", ranMs: 600_123, lastStatus: "running", exitCode: 2 }),
    });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(504);
    const body = JSON.stringify(await res.json());
    expect(JSON.parse(body)).toEqual({
      success: false,
      error: "timeout",
      ranMs: 600_123,
      lastStatus: "running",
      exitCode: 2,
    });
    expect(body).not.toContain("postgresql://");
    expect(body).not.toContain("db.test");
  });

  it("answers 504 without exitCode when the timed-out state has none", async () => {
    const { app, token } = await makeApp({
      runContainer: (): Promise<ContainerOutcome> =>
        Promise.resolve({ kind: "timeout", ranMs: 12_345, lastStatus: "running" }),
    });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({
      success: false,
      error: "timeout",
      ranMs: 12_345,
      lastStatus: "running",
    });
  });
});

it("exposes /healthz", async () => {
  const { app } = await makeApp();
  const res = await app.request("https://migrator.test/healthz", {}, testEnv());
  expect(res.status).toBe(200);
});

// #1365 — the other side of the handshake: an expectedHead the carried bundle
// DOES reach runs the apply through and reports that same head back, which is
// what `migrate-through-worker.sh` verifies before the release moves on.
it("applies and reports the expected head when the bundle carries it", async () => {
  const { app, token } = await makeApp();
  const res = await app.request(post({ expectedHead: HEAD_B }, token), {}, testEnv());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    success: true,
    exitCode: 0,
    appliedHead: HEAD_B,
    pathVerification: "verified",
  });
});
