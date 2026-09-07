/// <reference types="@cloudflare/workers-types" />

/**
 * The `AgentSession` Durable Object — one instance per session, and the place a
 * turn actually runs (card #1252, spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §二/§三).
 *
 * WHY THE TURN RUNS IN `alarm()` AND NOT IN `fetch`: a fetch's wall time is
 * unbounded only while the CALLER stays connected — Cloudflare may cancel the
 * associated work once it hangs up — whereas an `alarm()` handler owns its own
 * 15-minute wall clock, independent of any connection. That is the binding
 * decision of §二, and it is why hanging up cannot stop a turn.
 *
 * The two calls this class answers are two halves of the same contract:
 * - `POST /arm` writes the run id into STORAGE and arms `setAlarm(now)`. The
 *   intake calls it after its transaction commits, and the singleton
 *   `RunSweeper` calls it again for anything stranded; both are idempotent
 *   because the lease decides, not the wake-up (§三).
 * - `GET /stream?runId=` registers an in-memory subscriber and hands back an
 *   SSE body, for a run this session still owes work for; anything else is a
 *   404 the caller reads back instead. `fetch` and `alarm()` run on the same
 *   incarnation and share its heap, which is the entire handoff mechanism;
 *   subscribers are not persisted, so an eviction costs the live view and
 *   nothing else.
 *
 * A plain Durable Object class, like `EdgeGuard` and `RunSweeper`: no
 * `cloudflare:workers` import, so every module it reaches stays importable
 * under `node:test`.
 */
import type { ByokCredential } from "../byok/byok-credential.ts";
import { driveQueuedRun } from "./session-turn.ts";
import { DurableEnvelopeStore } from "./durable-envelope-store.ts";
import type { SessionEnvelopeStore } from "./session-envelope.ts";
import { SessionRunQueue } from "./session-run-queue.ts";
import { armedCredential, armedRunId, SESSION_ARM_PATH } from "./session-wakeup.ts";
import { agentDatabaseIn } from "../../db/agent-database.ts";
import { answerPrefixSeeding, prefixSeedingOn, SESSION_PREFIX_PATH } from "./session-prefix.ts";
import { sseResponse } from "./sse-turn-channel.ts";
import { TurnSubscribers } from "./turn-subscribers.ts";

/** Where a connected client reads one run's live frames. */
export const SESSION_STREAM_PATH = "/stream";

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

export class AgentSession {
  readonly #ctx: DurableObjectState;
  readonly #env: Record<string, unknown>;
  readonly #queue: SessionRunQueue;
  /** The session state that outlives one alarm, in this instance's own storage
   * — the same single-writer argument the queue above is kept there for. */
  readonly #envelopes: SessionEnvelopeStore;
  readonly #subscribers = new TurnSubscribers();
  /**
   * The caller-supplied credentials this incarnation was armed with, by run
   * (W2-3 #1289). HEAP ONLY, like `#subscribers` and for the same reason `ctx.
   * storage` is wrong for it: a BYOK key is the one thing about a turn that
   * must not outlive it. `#arm` and `alarm()` are two calls on one incarnation,
   * which is the whole mechanism.
   *
   * AN EVICTION BETWEEN THE TWO — or a `RunSweeper` re-arm of a stranded run —
   * reaches `#drive` with the entry gone, and this class cannot tell that run
   * apart from a plain one. It does not have to: the RUN ROW can, because a
   * caller-keyed turn is committed as `payer = 'byok'`, and `DurableTurn`
   * refuses to drive such a run on the server key (see its header). The key
   * itself is still written nowhere — only the fact that there was one.
   */
  readonly #credentials = new Map<string, ByokCredential>();

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    this.#ctx = ctx;
    this.#env = env;
    this.#queue = new SessionRunQueue(ctx.storage);
    this.#envelopes = new DurableEnvelopeStore(ctx.storage);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === SESSION_ARM_PATH) return await this.#arm(request);
    if (url.pathname === SESSION_STREAM_PATH) return await this.#stream(url);
    if (url.pathname === SESSION_PREFIX_PATH) return await this.#seedPrefix(request);
    return notFound();
  }

  /** One alarm drains every run this session was armed for. A run stays queued
   * until it is driven, so the platform's retry finds it again. */
  async alarm(): Promise<void> {
    for (const runId of await this.#queue.pending()) {
      await this.#drive(runId);
      await this.#queue.dequeue(runId);
    }
  }

  async #arm(request: Request): Promise<Response> {
    const credential = armedCredential(request);
    const runId = await armedRunId(request);
    if (runId === undefined) return new Response("Bad request", { status: 400 });
    if (credential !== null) this.#credentials.set(runId, credential);
    await this.#queue.queue(runId);
    await this.#ctx.storage.setAlarm(Date.now());
    return new Response(null, { status: 204 });
  }

  /**
   * A live view exists only for a run this session still owes work for. The
   * alarm and this fetch are two calls on one incarnation, so the alarm can
   * already have driven the run to its ending — a subscriber registered after
   * that would hold a channel nothing will ever write a frame or a terminator
   * to. The queue read is handed over IN FLIGHT so the subscriber set settles
   * it and registers in one uninterrupted step; a refused view is a 404 the
   * caller degrades to the retrieval surface (§二).
   */
  async #stream(url: URL): Promise<Response> {
    const runId = url.searchParams.get("runId");
    if (runId === null || runId === "") return notFound();
    const view = await this.#subscribers.openLiveView(runId, this.#queue.holds(runId));
    return view === null ? notFound() : sseResponse(view.body);
  }

  /**
   * Seed a frozen trajectory prefix into this session (E-1 #1380).
   *
   * It runs HERE, and not in the Worker, because half of a prefix is the
   * session envelope and that lives in this instance's own storage — the same
   * single-writer argument the queue and the envelope are kept here for. The
   * identity it writes on behalf of was verified by the gateway and rides the
   * request; `answerPrefixSeeding` re-reads it and the seeding checks the
   * session's ownership against it.
   */
  #seedPrefix(request: Request): Promise<Response> {
    const owner = this.#ctx.id.toString();
    const parts = { env: this.#env, envelopes: this.#envelopes, owner };
    return answerPrefixSeeding(prefixSeedingOn(parts, agentDatabaseIn(this.#env)), request);
  }

  /** One run, then close whoever was watching it. The credential is dropped
   * on the way out whatever the turn did — a spent key is not kept warm for a
   * retry that would have to be re-armed with it anyway. */
  async #drive(runId: string): Promise<void> {
    const emit = this.#subscribers.sinkFor(runId);
    const owner = this.#ctx.id.toString();
    const queued = await this.#queue.pending();
    const byok = this.#credentials.get(runId);
    const parts = { env: this.#env, emit, owner, envelopes: this.#envelopes, queued, byok };
    await driveQueuedRun(parts, runId).finally(() => this.#credentials.delete(runId));
    await this.#subscribers.finish(runId);
  }
}
