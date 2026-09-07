/// <reference types="@cloudflare/workers-types" />

/**
 * Both halves of the hop that seeds a frozen prefix (E-1 #1380), the way
 * `session-wakeup.ts` owns both halves of `POST /arm`.
 *
 * The seeding must run INSIDE the session's Durable Object, because the
 * envelope it writes lives in that instance's storage and nowhere else (spec
 * §三's single writer, `durable-envelope-store.ts`'s storage decision). So the
 * gateway's job is only to authenticate, and this hop is how the identity it
 * verified reaches the writer.
 *
 * THE IDENTITY RIDES A HEADER, NOT THE BODY, for the reason the BYOK credential
 * does on the arm hop: the body is the CALLER's, byte for byte, and re-wrapping
 * it would put a caller-supplied document and a server-derived fact in one
 * structure where a later reader has to remember which is which. The header is
 * added by `gateway/staging-prefix-route.ts` after `authenticate` returned `ok`
 * and can be added nowhere else — this is a Durable Object stub fetch, which
 * never leaves the account and reaches no router.
 *
 * `APP_ENV` IS NOT CHECKED HERE, and that is deliberate. The mount switch
 * decides whether this route exists on a deployment; it is not an
 * authorisation, so the ownership check below runs on staging exactly as it
 * would anywhere else (`prefix-seeding.ts` owns it).
 */
import type { AgentDatabase, AgentTransactions } from "../../db/agent-database.ts";
import { gatewayRejection } from "../../gateway/responses.ts";
import { NeonTurnRecords } from "../intake/neon-turn-records.ts";
import { SessionBusyError, SessionOwnershipError } from "../intake/turn-intake.ts";
import { usagePricesIn } from "../settlement/turn-settlement.ts";
import { NeonSeededSession } from "./neon-seeded-session.ts";
import { NeonTurnStore } from "./neon-turn-store.ts";
import {
  PrefixNotWritableError,
  SessionNotEmptyError,
  seedTrajectoryPrefix,
  type PrefixSeedingParts,
  type PrefixSeedingRequest,
  type SeededPrefixReceipt,
} from "./prefix-seeding.ts";
import type { SessionEnvelopeStore } from "./session-envelope.ts";
import { trajectoryPrefixIn } from "./trajectory-prefix.ts";

/** The path a seeding request carries on the stub fetch. */
export const SESSION_PREFIX_PATH = "/seed-prefix";

/** The identity the gateway verified, and the session it named. Neither is
 * readable from inside the Durable Object: `ctx.id` is the hashed name, not
 * the session id, and no request to a stub carries an identity by itself. */
const SEED_IDENTITY_HEADER = "X-Seed-Identity-Id";
const SEED_SESSION_HEADER = "X-Seed-Session-Id";

/** The seeding request the session's instance answers, with the caller's own
 * body unchanged. */
export function prefixSeedRequest(sessionId: string, identityId: string, body: string): Request {
  return new Request(`https://agent-session${SESSION_PREFIX_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [SEED_IDENTITY_HEADER]: identityId,
      [SEED_SESSION_HEADER]: sessionId,
    },
    body,
  });
}

/** One header the hop must carry, or nothing. */
function requiredHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.trim() ?? "";
  return value === "" ? null : value;
}

/**
 * Every refusal this procedure answers, and the status each takes.
 *
 * The ownership refusal is a 404 rather than a 403, which is
 * `ConversationRetrieval`'s own rule carried over: missing and forbidden
 * collapse, so knowing a session id tells a caller nothing about whose it is.
 * A busy session rides the same 409 as the non-empty one — an in-flight run is
 * a session that has already taken a turn, seen from the other side.
 */
function refusalFor(error: unknown): Response | null {
  if (error instanceof SessionOwnershipError) return gatewayRejection("not_found", 404);
  if (error instanceof SessionNotEmptyError) return gatewayRejection("session_not_empty", 409);
  if (error instanceof SessionBusyError) return gatewayRejection("session_not_empty", 409);
  if (error instanceof PrefixNotWritableError) return gatewayRejection("prefix_not_written", 409);
  return null;
}

/**
 * The seeding one hop performs: the request the caller's body parsed into, and
 * either its receipt or one of the four refusals above.
 *
 * A PORT rather than a direct call to `seedTrajectoryPrefix`, because each of
 * those refusals is raised behind `withAgentDatabase` — by `factsOf`, by
 * `openTurn`, by the lease — while the status each takes is decided HERE. With
 * the call inlined, the whole map was reachable only from a lane that boots
 * PostgreSQL, and it was asserted nowhere: a catch that answered a blanket 400
 * for every error passed the entire suite (#1436). In front of the port, one
 * seeding that raises is one status asserted.
 */
export type PrefixSeeding = (request: PrefixSeedingRequest) => Promise<SeededPrefixReceipt>;

/** What the Durable Object supplies that the composition below cannot derive. */
export interface SessionPrefixParts {
  readonly env: Record<string, unknown>;
  readonly envelopes: SessionEnvelopeStore;
  /** The incarnation taking the seeded run's lease — `ctx.id.toString()`. */
  readonly owner: string;
}

/**
 * The seeded run's payer.
 *
 * Always a member's. The gateway admits this procedure only to a caller whose
 * Neon Auth bearer verified (`gateway/staging-prefix-route.ts`), so there is no
 * anonymous branch to classify — and a prefix that metered a daily anonymous
 * message would charge the eval identity for a turn nobody took.
 */
const PREFIX_PAYER = "user";

/** The seeding, wired to the agent data plane for one unit of work — the same
 * shape `driveQueuedRun` gives a turn, so the three adapters share one pool. */
function seedingParts(parts: SessionPrefixParts, transactions: AgentTransactions): PrefixSeedingParts {
  return {
    records: new NeonSeededSession(transactions),
    turns: new NeonTurnRecords(transactions),
    store: new NeonTurnStore(transactions),
    envelopes: parts.envelopes,
    owner: parts.owner,
    prices: usagePricesIn(parts.env),
    now: Date.now,
  };
}

/**
 * The seeding the session's Durable Object performs: one seeding, on one unit
 * of work of whichever data plane it was handed.
 *
 * The data plane is a parameter and not `withAgentDatabase` inlined, so this
 * composition — the adapters `seedingParts` wires, and the fact that a refusal
 * leaves it as the CLASS `refusalFor` reads — is driven against a real
 * PostgreSQL in `agent-db-test/trajectory-prefix.db.test.ts`. Inlined, it was
 * reachable from no lane at all, and a catch that replaced every refusal with
 * a plain `Error` survived the whole suite (#1436).
 */
export function prefixSeedingOn(parts: SessionPrefixParts, database: AgentDatabase): PrefixSeeding {
  return (request) => database((transactions) =>
    seedTrajectoryPrefix(seedingParts(parts, transactions), request));
}

/** One seeding, once the caller's body has been read as a prefix. */
async function seededOn(
  seeding: PrefixSeeding, sessionId: string, identityId: string, body: unknown,
): Promise<Response> {
  const prefix = trajectoryPrefixIn(body);
  if (prefix === null) return gatewayRejection("invalid_prefix", 400, "The prefix could not be read.");
  const receipt = await seeding({ sessionId, identityId, payer: PREFIX_PAYER, prefix });
  return Response.json({ session_id: sessionId, seeded: receipt.seeded });
}

/**
 * The caller's body, or the sentinel a body that is not JSON at all takes.
 *
 * `request.json()` throws a `SyntaxError` on a malformed document, and that
 * error belongs to nothing `refusalFor` above knows: left to propagate it
 * reaches `app.onError` and is answered as a 500 (`gatewayFailure`), which
 * reports a gateway fault for a body the CALLER wrote. It is the same class of
 * refusal as a body that parses into no prefix, so it takes the same 400.
 */
const UNREADABLE_BODY: unique symbol = Symbol("body that is not JSON");

async function jsonBodyIn(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return UNREADABLE_BODY;
  }
}

const NOT_JSON_MESSAGE = "The prefix body is not JSON.";

/** The seeding this hop asks for, once every part of it is readable. */
async function readableSeeding(seeding: PrefixSeeding, request: Request): Promise<Response> {
  const identityId = requiredHeader(request, SEED_IDENTITY_HEADER);
  const sessionId = requiredHeader(request, SEED_SESSION_HEADER);
  if (identityId === null || sessionId === null) return gatewayRejection("invalid_prefix", 400);
  const body = await jsonBodyIn(request);
  if (body === UNREADABLE_BODY) return gatewayRejection("invalid_prefix", 400, NOT_JSON_MESSAGE);
  return await seededOn(seeding, sessionId, identityId, body);
}

/**
 * The seeding request `AgentSession.fetch` answers.
 *
 * A missing header is a 400 and not a 404: the hop is built by one function in
 * this repository, so a request without them is a broken caller rather than an
 * unknown route, and answering 404 would hide the breakage behind the same
 * status an unowned session gets.
 */
export async function answerPrefixSeeding(
  seeding: PrefixSeeding, request: Request,
): Promise<Response> {
  try {
    return await readableSeeding(seeding, request);
  } catch (error) {
    const refusal = refusalFor(error);
    if (refusal === null) throw error;
    return refusal;
  }
}
