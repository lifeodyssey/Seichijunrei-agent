import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nativeApp, requestMetadata, TARGET } from "./integration/prisma-fixture";
import { FIXED_NOW, makeApp, testEnv } from "./migrate.worker.helpers";
import { preflightRequest } from "./preflight-fixtures";
import { serveSelectedLedger } from "./prisma-ledger-fixture";

const native = vi.hoisted(() => ({ show: vi.fn(), connect: vi.fn(), migrate: vi.fn(), close: vi.fn() }));
vi.mock("@prisma/orm-toolchain/cli/control-api", () => ({ executeMigrateShowPlan: native.show }));
vi.mock("@prisma/orm-postgres/control", () => ({ createPostgresControlClient: () => native }));
const DSN = "postgresql://fake:migrator@db.test/neondb";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
  vi.resetAllMocks();
  serveSelectedLedger();
  native.show.mockResolvedValue({ ok: true, value: { migrations: [], renderMarkerHashBySpace: new Map([["app", TARGET]]), usedLiveMarker: true } });
  native.migrate.mockResolvedValue({ ok: true, value: { markerHash: TARGET, migrationsApplied: 0, applied: [] } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("returns the native marker and zero-operation receipt through authenticated HTTP", async () => {
  const app = await nativeApp(DSN);
  const response = await app.migrate();
  expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 200, body: {
    success: true, prisma: { markerHash: TARGET, migrationsApplied: 0 },
  } });
  expect(native.close).toHaveBeenCalledOnce();
});

it("retains the public preview API's live-marker flag without assuming it is true", async () => {
  native.show.mockResolvedValue({ ok: true, value: { migrations: [], renderMarkerHashBySpace: new Map([["app", "empty"]]), usedLiveMarker: false } });
  const response = await (await nativeApp(DSN)).preview();
  expect(await response.json()).toMatchObject({ prisma: { markerHash: "empty", usedLiveMarker: false } });
});

it("refuses a native path failure before attempting either owner's DDL", async () => {
  native.show.mockResolvedValue({ ok: false, failure: { code: "NO_FORWARD_PATH", message: "private SQL" } });
  const response = await (await nativeApp(DSN)).migrate();
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: "NO_FORWARD_PATH" });
  expect(native.connect).not.toHaveBeenCalled();
});

it("refuses a preview whose native marker is unavailable", async () => {
  native.show.mockResolvedValue({ ok: true, value: { migrations: [], renderMarkerHashBySpace: new Map(), usedLiveMarker: true } });
  const response = await (await nativeApp(DSN)).preview();
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ compatible: false, error: "prisma_marker_unavailable" });
});

it("sanitizes thrown native preview errors", async () => {
  native.show.mockRejectedValue(new Error("postgresql://secret@private.test/db"));
  const response = await (await nativeApp(DSN)).preview();
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ compatible: false, error: "preflight_unavailable" });
});

it("returns only the native failure code and closes the control client", async () => {
  native.migrate.mockResolvedValue({ ok: false, failure: { code: "DDL_FAILED", message: "private SQL" } });
  const response = await (await nativeApp(DSN)).migrate();
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ success: false, error: "DDL_FAILED" });
  expect(native.close).toHaveBeenCalledOnce();
});

it("refuses a successful native result that names a different marker", async () => {
  native.migrate.mockResolvedValue({ ok: true, value: { markerHash: "f".repeat(64), migrationsApplied: 0 } });
  const response = await (await nativeApp(DSN)).migrate();
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ error: "prisma_marker_mismatch" });
});

it("sanitizes connection failures and still closes the native client", async () => {
  native.connect.mockRejectedValue(new Error("postgresql://secret@private.test/db"));
  const response = await (await nativeApp(DSN)).migrate();
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ error: "migration_unavailable" });
  expect(native.close).toHaveBeenCalledOnce();
});

it("rejects native metadata with arbitrary SQL instead of falling back to legacy apply", async () => {
  const { app, token } = await makeApp();
  const response = await app.request(preflightRequest({ ...requestMetadata, sql: "DROP TABLE pi_sessions" }, token), {}, testEnv());
  expect(response.status).toBe(400);
  expect(native.show).not.toHaveBeenCalled();
});
