import { delay, http, HttpResponse } from "msw";
import type { HttpHandler } from "msw";
import { expect, it } from "vitest";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { assertCleanBoundary, expectAbandonedRequests, lastDrainOutcome } from "../../msw/in-flight-requests";
import type { DrainOutcome } from "../../msw/in-flight-requests";
import { server } from "../../msw/node";
import lifecycleSource from "../../setup/msw-lifecycle.ts?raw";

const SLOW_URL = `${TEST_ORIGIN}/v1/drain-slow`;
const PENDING_URL = `${TEST_ORIGIN}/v1/drain-pending`;

/**
 * The recorder of whichever case is live — the seam #1503's flake ran through.
 * Each case installs its own, exactly as the chat cases install their own spies.
 */
let answeredInto: string[] = [];

/** The turn the first case walks away from; the second case reads its outcome. */
const abandoned: Promise<Response>[] = [];

/** Answers only after 300 ms, so a case that does not await it ends first. */
function slowTurn(): HttpHandler {
  return http.post(SLOW_URL, async () => {
    await delay(300);
    answeredInto.push("turn");
    return HttpResponse.json({ ok: true });
  });
}

/** Never answers — the shape a "still verifying" case leaves behind on purpose. */
function pendingTurn(): HttpHandler {
  return http.post(PENDING_URL, () => new Promise<Response>(() => undefined));
}

function outcome(fields: Partial<DrainOutcome> = {}): DrainOutcome {
  return { settled: 0, abandoned: ["POST /probe"], declared: 0, timedOut: false, ...fields };
}

it("ends the case with a turn still in flight", () => {
  answeredInto = [];
  server.use(slowTurn());
  abandoned.push(fetch(SLOW_URL, { method: "POST" }));
  expect(answeredInto).toEqual([]);
});

it("hands the next case a recorder the abandoned turn cannot reach", async () => {
  answeredInto = [];
  await Promise.all(abandoned);
  expect(answeredInto).toEqual([]);
  expect(lastDrainOutcome()).toEqual({ settled: 1, abandoned: [], declared: 0, timedOut: false });
});

it("ends the case with one declared pending request", () => {
  expectAbandonedRequests(1);
  server.use(pendingTurn());
  void fetch(PENDING_URL, { method: "POST" });
});

it("reports the declared request as abandoned without waiting out the bound", () => {
  expect(lastDrainOutcome()).toEqual({
    settled: 0,
    abandoned: [`POST ${PENDING_URL}`],
    declared: 1,
    timedOut: false,
  });
});

it("fails a case that abandoned a request it never declared", () => {
  expect(() => { assertCleanBoundary(outcome()); }).toThrow(/abandoned 1 request\(s\) but declared 0/);
});

it("passes a case whose abandonment matches what it declared", () => {
  expect(() => { assertCleanBoundary(outcome({ declared: 1 })); }).not.toThrow();
});

it("fails a drain that waited out its bound, declared or not", () => {
  expect(() => { assertCleanBoundary(outcome({ declared: 1, timedOut: true })); }).toThrow(/waited out the bound/);
});

/** A hook failure is invisible to the file that caused it, so pin the wiring itself. */
it("wires the boundary guard into the shared afterEach", () => {
  expect(lifecycleSource).toContain("assertCleanBoundary(outcome)");
});
