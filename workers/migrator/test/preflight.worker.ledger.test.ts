import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FIXED_NOW } from "./migrate.worker.helpers";
import { metadata, preflightRequest, serveLedger, signedApp } from "./preflight-fixtures";
import { PREFIX_CASES, REFUSAL_CASES } from "./preflight.cases";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(PREFIX_CASES)("accepts $name", async ({ rows, pendingCount }) => {
  serveLedger(rows);
  const { app, token, env } = await signedApp();
  const response = await app.request(preflightRequest(metadata, token), undefined, env);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ compatible: true, expectedHead: metadata.expectedHead, pendingCount });
});

it.each(REFUSAL_CASES)("refuses $name without returning ledger details", async ({ rows, error }) => {
  serveLedger(rows);
  const { app, token, env } = await signedApp();
  const response = await app.request(preflightRequest(metadata, token), undefined, env);
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ compatible: false, error });
});
