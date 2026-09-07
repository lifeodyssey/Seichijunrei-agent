/**
 * E-1 (#1380): every answer the seeding hop gives that is not a receipt.
 *
 * Two halves, and they meet at one `try`. The first is the request that cannot
 * be READ at all — the identity headers, and the body as JSON — refused before
 * the data plane is opened. The class that half exists for is the one with no
 * `refusalFor` entry: `request.json()` throws a `SyntaxError` on a malformed
 * document, and an unmapped throw out of `AgentSession.fetch` is answered by
 * `app.onError` as a 500 — a gateway fault reported for a body the caller wrote.
 *
 * The second is the seeding itself REFUSING, which is `refusalFor`'s map from
 * four domain errors onto three statuses. Nothing asserted that map until
 * #1436: the errors are raised by the Neon adapters (`factsOf`, `openTurn`, the
 * lease), so with the seeding inlined behind `withAgentDatabase` a catch that
 * answered a blanket 400 for everything passed the whole edge suite. The
 * `PrefixSeeding` port is what a case here supplies instead, and what it reads
 * back is the response the caller gets.
 *
 * The statuses are load-bearing downstream: `packages/eval`'s
 * `PrefixSeedingFailure` carries this status precisely because "an unowned
 * session (404) and a session that already has turns (409) are different
 * mistakes".
 *
 * Neither half needs Neon, and a case that reached one would fail loudly.
 *
 * test-type: unit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SessionBusyError, SessionOwnershipError } from "../src/agent/intake/turn-intake.ts";
import { PrefixNotWritableError, SessionNotEmptyError } from "../src/agent/session/prefix-seeding.ts";
import { answerPrefixSeeding, prefixSeedRequest } from "../src/agent/session/session-prefix.ts";
import { notFoundResponse } from "../src/gateway/responses.ts";
import { makeRefusingSeeding } from "./doubles/make-refusing-seeding.ts";
import { makePrefixBody, SEEDING_IDENTITY } from "./doubles/make-trajectory-prefix.ts";

/** The refusal a case that never reaches the data plane would be answered by,
 * so an unreadable request that somehow got through is not silently a 4xx. */
const UNREACHED = new Error("the seeding must not be reached");

/** A body every part of which reads, so the hop gets as far as the seeding. */
const READABLE_BODY = JSON.stringify(makePrefixBody());

interface HopAnswer {
  readonly status: number;
  readonly code: unknown;
  readonly message: unknown;
  /** How many seedings the hop asked the data plane for. */
  readonly seedings: number;
}

/** One hop, over a data plane that refuses with `refusal` if it is reached. */
async function answered(refusal: Error, request: Request): Promise<HopAnswer> {
  const refusing = makeRefusingSeeding(refusal);
  const response = await answerPrefixSeeding(refusing.seeding, request);
  const read = await response.json() as { error?: { code?: unknown; message?: unknown } };
  return {
    status: response.status,
    code: read.error?.code,
    message: read.error?.message,
    seedings: refusing.requests.length,
  };
}

/** The hop as `staging-prefix-route.ts` builds it, carrying one body. */
function seedRequest(body: string): Request {
  return prefixSeedRequest("session-42", SEEDING_IDENTITY, body);
}

/** What one refusal out of the seeding is answered as. */
function refusalOf(refusal: Error): Promise<HopAnswer> {
  return answered(refusal, seedRequest(READABLE_BODY));
}

void test("a body that is not JSON is the caller's 400, never a thrown gateway fault", async () => {
  const answer = await answered(UNREACHED, seedRequest('{"case_id": '));

  assert.equal(answer.status, 400);
  assert.equal(answer.code, "invalid_prefix");
  assert.equal(answer.seedings, 0);
});

void test("an empty body is refused on the same terms", async () => {
  const answer = await answered(UNREACHED, seedRequest(""));

  assert.equal(answer.status, 400);
  assert.equal(answer.code, "invalid_prefix");
});

void test("a body that is JSON but no prefix takes the same status under its own message", async () => {
  const answer = await answered(UNREACHED, seedRequest("{}"));

  assert.equal(answer.status, 400);
  assert.equal(answer.message, "The prefix could not be read.");
  assert.equal(answer.seedings, 0);
});

void test("a hop without its identity header is a 400 rather than an unknown route", async () => {
  const bare = new Request("https://agent-session/seed-prefix", { method: "POST", body: "{}" });

  const answer = await answered(UNREACHED, bare);

  assert.equal(answer.status, 400);
  assert.equal(answer.seedings, 0);
});

void test("a session that is not the caller's is a 404 not_found", async () => {
  const answer = await refusalOf(new SessionOwnershipError());

  assert.equal(answer.status, 404);
  assert.equal(answer.code, "not_found");
});

void test("a session that has already taken a turn is a 409 session_not_empty", async () => {
  const answer = await refusalOf(new SessionNotEmptyError());

  assert.equal(answer.status, 409);
  assert.equal(answer.code, "session_not_empty");
});

void test("a session with a live run rides the same 409 session_not_empty", async () => {
  const answer = await refusalOf(new SessionBusyError("running_turn"));

  assert.equal(answer.status, 409);
  assert.equal(answer.code, "session_not_empty");
});

void test("a seeded run that could not be written is a 409 prefix_not_written", async () => {
  const answer = await refusalOf(new PrefixNotWritableError("its lease is held by another writer"));

  assert.equal(answer.status, 409);
  assert.equal(answer.code, "prefix_not_written");
});

/**
 * The collapse `refusalFor` was written for: the ownership refusal is a 404 and
 * not a 403, carrying the same status and the same `not_found` code this Worker
 * gives a path it has no route for. It says strictly LESS than that answer —
 * `notFoundResponse` explains itself ("No route matches this request."), while
 * this one carries no message at all, so there is no sentence naming an owner
 * or a session for a caller to read a session id's fate out of.
 */
void test("the ownership refusal is an unmatched path's status and code, and says less", async () => {
  const answer = await refusalOf(new SessionOwnershipError());
  const unmatched = await notFoundResponse().json() as { error: { code: string } };

  assert.equal(answer.status, notFoundResponse().status);
  assert.equal(answer.code, unmatched.error.code);
  assert.equal(answer.message, undefined);
});
