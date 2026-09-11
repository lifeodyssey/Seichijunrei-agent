import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FIXED_NOW } from "./migrate.worker.helpers";
import { metadata, preflightRequest, signedApp } from "./preflight-fixtures";
import { PRISMA_TARGET } from "../src/prisma-target";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const privateMessage = "postgresql://admin:secret@private.test/db SELECT secret FROM private";

it("sanitizes a rejected secret binding", async () => {
  const { app, token, env } = await signedApp();
  const get = vi.fn(() => Promise.reject(new Error(privateMessage)));
  const response = await app.request(preflightRequest(metadata, token), undefined,
    { ...env, MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "preflight_unavailable" });
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it.each([undefined, "", "invalid-dsn"])("refuses an unavailable binding %s", async (dsn) => {
  const { app, token, env } = await signedApp();
  const response = await app.request(preflightRequest(metadata, token), undefined,
    { ...env, MIGRATOR_DATABASE_URL: dsn });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "preflight_unavailable" });
});

it.each([
  ["42P01", 422, { compatible: false, error: "ledger_missing" }],
  ["42501", 503, { error: "preflight_unavailable" }],
  ["08006", 503, { error: "preflight_unavailable" }],
  ["XX000", 503, { error: "preflight_unavailable" }],
])("sanitizes native Neon SQLSTATE %s", async (code, status, expected) => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({ code, message: privateMessage }, { status: 400 }))));
  const { app, token, env } = await signedApp();
  const response = await app.request(preflightRequest(metadata, token), undefined, env);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(expected);
});

it("sanitizes an unexpected transport failure", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error(privateMessage))));
  const { app, token, env } = await signedApp();
  const response = await app.request(preflightRequest(metadata, token), undefined, env);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "preflight_unavailable" });
});

it("keeps healthz as public bundle metadata without reading the ledger", async () => {
  const { app, env } = await signedApp();
  const get = vi.fn(() => Promise.reject(new Error(privateMessage)));
  const response = await app.request("/healthz", undefined, { ...env, MIGRATOR_DATABASE_URL: { get } });
  expect(await response.json()).toEqual({ status: "ok", service: "migrator", env: "staging", bundleHead: "20251201000000_old",
    prismaTarget: PRISMA_TARGET });
  expect(get).not.toHaveBeenCalled();
});
