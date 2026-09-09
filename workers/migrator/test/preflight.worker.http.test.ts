import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HEAD_A, HEAD_B, metadata, preflightRequest, revision, serveLedger, signedApp } from "./preflight-fixtures";
import { FIXED_NOW } from "./migrate.worker.helpers";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("accepts a verified prefix of a selected chain newer than the serving bundle", async () => {
  const transport = serveLedger([revision()]);
  const { app, token, env } = await signedApp();
  const response = await app.request(preflightRequest(metadata, token), {}, env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ compatible: true, expectedHead: HEAD_B, appliedHead: HEAD_A, pendingCount: 1 });
  expect(transport).toHaveBeenCalledOnce();
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("sends a complete fixed SELECT inside native read-only repeatable-read Neon HTTP", async () => {
  const transport = serveLedger([revision()]);
  const { app, token, env } = await signedApp();
  await app.request(preflightRequest(metadata, token), undefined, env);
  const options = transport.mock.calls[0]?.[1];
  const headers = new Headers(options?.headers);
  expect(headers.get("Neon-Batch-Read-Only")).toBe("true");
  expect(headers.get("Neon-Batch-Isolation-Level")).toBe("RepeatableRead");
  expect(options?.body).toBe(JSON.stringify({ queries: [{
    query: "SELECT version, description, type::text, applied::text, total::text, hash, error\n        FROM public.atlas_schema_revisions ORDER BY version",
    params: [],
  }] }));
});
