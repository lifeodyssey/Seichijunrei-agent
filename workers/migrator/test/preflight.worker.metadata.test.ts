import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FIXED_NOW, productionEnv } from "./migrate.worker.helpers";
import { HEAD_A, HASH_A, metadata, preflightRequest, revision, serveLedger, signedApp } from "./preflight-fixtures";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const [header, first, second] = metadata.atlasSum.trimEnd().split("\n");
const withSum = (atlasSum: string) => ({ ...metadata, atlasSum });

it.each([
  ["null", null], ["array", []], ["missing properties", {}],
  ["SQL", { ...metadata, sql: "DROP SCHEMA public CASCADE" }],
  ["DSN", { ...metadata, dsn: "postgresql://private:secret@evil.test/private" }],
  ["environment override", { ...metadata, environment: "production" }],
  ["URL", { ...metadata, url: "https://evil.test" }],
  ["string flag", { ...metadata, stagingOnlyBaseline: "false" }],
  ["head type", { ...metadata, expectedHead: 10 }],
  ["sum type", { ...metadata, atlasSum: {} }],
  ["wrong head", { ...metadata, expectedHead: HEAD_A }],
  ["duplicate", withSum([header, first, first, second].join("\n"))],
  ["unordered", withSum([header, second, first].join("\n"))],
  ["same version", withSum([header, first, first?.replace("baseline", "other"), second].join("\n"))],
  ["path traversal", withSum(metadata.atlasSum.replace("_baseline.sql", "_/baseline.sql"))],
  ["base64 alphabet", withSum(metadata.atlasSum.replace(HASH_A, "!".repeat(43) + "="))],
  ["noncanonical base64", withSum(metadata.atlasSum.replace(HASH_A, HASH_A.slice(0, -2) + "V="))],
  ["unsupported hash", withSum(metadata.atlasSum.replace("h1:", "h2:"))],
  ["empty sum", withSum("")], ["header only", withSum(header ?? "")],
  ["CRLF", withSum(metadata.atlasSum.replaceAll("\n", "\r\n"))],
])("refuses %s metadata before secret resolution or SQL", async (_name, body) => {
  const { app, token, env } = await signedApp();
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const transport = serveLedger([revision()]);
  const response = await app.request(preflightRequest(body, token), undefined,
    { ...env, MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_preflight" });
  expect(get).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it.each(["{", "", " ".repeat(65_537)])("refuses malformed or oversized JSON before the DSN (%#)", async (body) => {
  const { app, token, env } = await signedApp();
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const request = new Request(preflightRequest(metadata, token), { body });
  const response = await app.request(request, undefined, { ...env, MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(await response.json()).toEqual({ error: "invalid_preflight" });
  expect(get).not.toHaveBeenCalled();
});

it("bounds content-length declared requests before the DSN", async () => {
  const { app, token, env } = await signedApp();
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const request = preflightRequest(metadata, token);
  request.headers.set("content-length", "65537");
  const response = await app.request(request, undefined, { ...env, MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBe(413);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(get).not.toHaveBeenCalled();
});

it("bounds the decoded body even when content-length understates its size", async () => {
  const { app, token, env } = await signedApp();
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const request = preflightRequest({ ...metadata, atlasSum: " ".repeat(65_537) }, token);
  request.headers.set("content-length", "1");
  const response = await app.request(request, undefined, { ...env, MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBe(400);
  expect(get).not.toHaveBeenCalled();
});

it("refuses the staging-only baseline flag in production before the DSN", async () => {
  const { app, token } = await signedApp({ environment: "production" });
  const get = vi.fn(() => Promise.resolve("private-dsn"));
  const response = await app.request(preflightRequest({ ...metadata, stagingOnlyBaseline: true }, token), undefined,
    { ...productionEnv(), MIGRATOR_DATABASE_URL: { get } });
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ compatible: false, error: "staging_only_baseline" });
  expect(get).not.toHaveBeenCalled();
});
