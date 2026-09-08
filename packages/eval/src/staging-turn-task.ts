/**
 * One eval case, run as real turns against the deployed edge (W3-2 #1300).
 *
 * This is the `Dataset.evaluate` task. Spec §二 is why it is HTTP and not an
 * in-process call: the eval measures the deployed system, so the only thing it
 * may hold is a URL and a credential. Everything the evaluators need therefore
 * has to come back off the wire, which `turn-transcript.ts` does.
 *
 * IT MAKES NO REQUEST OF ITS OWN. Every call goes through the `TurnDoor` it is
 * given — in a real run that is `api-test/lane-origin.ts`'s `laneFetch`, the one
 * door that resolves the origin, refuses a plaintext one, attaches the staging
 * gate header and forbids following a redirect (#1291, #1294). Taking it as a
 * port rather than importing it keeps this file pure enough to test with a fake
 * fetch, and keeps the composition in `scripts/eval-staging.ts` where the real
 * credentials are read.
 *
 * WHAT IT RETRIES, AND WHAT IT MUST NOT. A rejected request never reached the
 * app: no turn was admitted, nothing was measured, and one retry is the
 * difference between a flaky Wi-Fi hop and a red case. Everything the app
 * ANSWERS is the measurement — a `tool-output-error`, an `error` frame, a
 * refusal, a 500 — and retrying any of them would quietly turn a failing case
 * into a passing one, which is the failure mode an eval exists to detect.
 */
import { getCurrentTaskRun, type TaskRunState } from "logfire/evals";
import type { GetSessionHistoryResponse } from "@animichi/contract/session-history-contract";

import { caseSubmissionsOf, type ChatSubmission } from "./case-submissions.ts";
import type { SeededSessions } from "./seeded-sessions.ts";
import type { ExportedAgentInput } from "./dataset-roundtrip.ts";
import { InFlightTurns } from "./in-flight-turns.ts";
import { priorTurnReturns } from "./prior-turn-returns.ts";
import type { StagingBearer } from "./staging-bearer.ts";
import { transcriptResultOf, turnFramesOf, type TranscriptResult } from "./turn-transcript.ts";

/** The only way this task reaches staging: a PATH and an init, never a URL. */
export type TurnDoor = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * How long one turn may take before the runner stops waiting.
 *
 * Strictly looser than the server's own budget — `TURN_DEADLINE_MS = 100_000`
 * in `workers/edge/src/agent/intake/turn-intake.ts` — plus the stream read and a
 * cold Durable Object. The coupling is one-way on purpose: a server deadline
 * that moves can only make this more generous, never make it cut a live turn
 * off and record a timeout as the agent's answer.
 */
export const TURN_TIMEOUT_MS = 130_000;

/** Two concurrent turns on one signed-in QA identity; see `InFlightTurns`. */
export const DEFAULT_MAX_CONCURRENCY = 2;

/** The header the edge answers with, naming the session the turn committed on. */
const SESSION_ID_HEADER = "x-session-id";

/**
 * The report attribute a prefix-seeded case carries (E-1 #1380).
 *
 * It is set from the TASK and not from `CaseLifecycle.setup()`, because the
 * driver opens a case's task-run context around the task only (`logfire/evals`'
 * case runner) and `setup()` has none to write into. What the task knows is
 * exactly what the attribute means: this case's turns ran on a session somebody
 * had already put a starting point in.
 */
export const PREFIX_SEEDED_ATTRIBUTE = "prefix_seeded";

/**
 * The seconds ONE case's own turns took, without the wait for a slot (#1476).
 *
 * The driver already times a case — `ReportCase.task_duration` is a
 * `performance.now()` difference taken inside the case runner, around the task
 * call and nothing else (`logfire/evals`' `runCase`: `let e = J(); try { return
 * await c(inputs) } finally { b = J() - e }`). That bracket is the problem: this
 * task ENTERS `InFlightTurns` inside the call, so a case's `task_duration` is
 * its queue wait plus its turn, and at the documented bound of two the wait is
 * most of it — the 662-case run of 2026-09-07 walled 8,795 s and summed
 * 3,043,667 of them, the last case alone reporting the whole run.
 *
 * So the turn times ITSELF, from inside the slot, and `run-spend.ts` sums these
 * instead. `Dataset.evaluate`'s own `maxConcurrency` acquires before that
 * bracket and would fix the arithmetic too, but it moves the bound protecting a
 * shared deployment out of the task and into whatever the caller remembered to
 * pass — and leaves the number on a clock no test can hold still.
 */
export const TURN_SECONDS_ATTRIBUTE = "turn_seconds";

/** What one case's submissions left behind: the turn that is being measured
 * (the LAST one — its predecessors only exist to put history in the session),
 * the session they all ran on, and those predecessors' streams. */
export interface SubmittedCase {
  readonly turn: Response | null;
  readonly sessionId: string | null;
  /**
   * The bodies of the submissions BEFORE the measured one, oldest first (E-3
   * #1382). They were dropped unread until now, and #1377 is why they are not
   * discardable any more: the edge replays every run of a session as structured
   * `toolResult` messages, so what those turns' tools returned is in front of
   * the model on the measured turn and a reply quoting one of them is quoting a
   * SOURCE. Read here rather than in the shaper because a `Response` body can
   * be consumed once, and this is where the responses are.
   */
  readonly priorStreams: readonly string[];
}

export interface StagingTurnSettings {
  readonly door: TurnDoor;
  readonly bearer: StagingBearer;
  /** A fresh dedupe key per submission (`x-turn-id`); injected so a test can
   * make it deterministic and a run cannot accidentally reuse one. */
  readonly turnId: () => string;
  readonly maxConcurrency?: number;
  readonly timeoutMs?: number;
  /**
   * Milliseconds from a monotonic clock, for the turn's own duration (#1476).
   *
   * Injected so a test can hold it still — the measurement this makes is the
   * difference between two reads taken inside the slot, and a test that asserted
   * on `performance.now()` would be asserting on how fast the machine was.
   * `performance.now()` when nobody supplies one, which is the clock the driver
   * times a case with.
   */
  readonly now?: () => number;
  /**
   * Where a case's frozen prefix was seeded, when it carries one (E-1 #1380).
   *
   * Optional because most runs seed nothing: a set with no `seeded_pending`
   * case needs no lifecycle and therefore no register, and an absent one reads
   * as "this case starts from an empty session" — which is what every case
   * outside `phase1c_selection_v1` does.
   */
  readonly sessions?: SeededSessions;
}

/** A request that never reached the app, and may therefore be sent again. */
export class TransportFailure extends Error {
  constructor(path: string, cause: unknown) {
    super(`the request to ${path} never reached staging`, { cause });
    this.name = "TransportFailure";
  }
}

/**
 * The seconds, onto the state of the case that spent them.
 *
 * Not `setEvalAttribute`, which looks the state up at WRITE time and would be
 * the obvious call: `logfire/evals` loads `node:async_hooks` lazily, so a case
 * that started before that import resolved is on a module-level fallback the
 * driver abandons the moment the storage exists, and a write made after the
 * turn — the only moment its duration is known — lands nowhere. Measured on the
 * first case of a process.
 *
 * `prefix_seeded` is written the same way now, and for the same reason (#1484).
 * It used to call `setEvalAttribute` from `#seededSession`, which is reached
 * through `#inFlight.enter` and therefore runs after a queue wait — and the
 * module-level fallback is ONE variable every case on it shares, so from the
 * third case of a run onwards that write landed on whichever case entered the
 * fallback last, or on nobody once the storage existed. The state `run`
 * captures is this case's under either regime, and the driver reads that same
 * object into the report when the case ends.
 */
function recordTurnSeconds(measured: TaskRunState | undefined, seconds: number): void {
  if (measured === undefined) return;
  measured.attributes[TURN_SECONDS_ATTRIBUTE] = seconds;
}

/** That this case started from a frozen prefix, onto its own state — a fact
 * known before the case queues, so it is written there rather than from behind
 * the wait (`recordTurnSeconds` carries the whole reason). */
function recordPrefixSeeded(measured: TaskRunState | undefined): void {
  if (measured === undefined) return;
  measured.attributes[PREFIX_SEEDED_ATTRIBUTE] = true;
}

export class StagingTurnTask {
  readonly #settings: StagingTurnSettings;
  readonly #inFlight: InFlightTurns;

  constructor(settings: StagingTurnSettings) {
    this.#settings = settings;
    this.#inFlight = new InFlightTurns(settings.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
  }

  /** The function `Dataset.evaluate` calls, bound to this task. */
  asTask(): (inputs: ExportedAgentInput) => Promise<TranscriptResult> {
    return (inputs) => this.run(inputs);
  }

  /** One case: its recorded history replayed, then the turn under measurement.
   * The case's own task-run state is taken HERE, before the queue, and both
   * report attributes go onto it — see `recordTurnSeconds` for why neither can
   * be written through a lookup made behind the wait. */
  run(inputs: ExportedAgentInput): Promise<TranscriptResult> {
    const measured = getCurrentTaskRun();
    if (this.#seededSession(inputs) !== null) recordPrefixSeeded(measured);
    return this.#inFlight.enter(() => this.#runCase(inputs, measured));
  }

  /**
   * Every body this case submits, on one session, keeping the last response.
   *
   * Public because `scripts/record-captures.ts` needs the RAW stream to write a
   * capture, and a second copy of this loop is a second place for the session
   * threading — the thing that makes a multi-turn case a conversation rather
   * than N strangers — to be got wrong.
   */
  async submitCase(inputs: ExportedAgentInput): Promise<SubmittedCase> {
    const priorStreams: string[] = [];
    let sessionId: string | null = this.#seededSession(inputs);
    let turn: Response | null = null;
    for (const submission of caseSubmissionsOf(inputs)) {
      if (turn !== null) priorStreams.push(await turn.text());
      turn = await this.#submit(submission, inputs.locale, sessionId);
      sessionId = turn.headers.get(SESSION_ID_HEADER) ?? sessionId;
    }
    return { turn, sessionId, priorStreams };
  }

  /** The session this case's prefix was seeded into, or `null` for a case with
   * no prefix, which starts where it always did. A pure lookup: `run` asks it
   * to mark the report, `submitCase` asks it where to send the turns. */
  #seededSession(inputs: ExportedAgentInput): string | null {
    return this.#settings.sessions?.of(inputs) ?? null;
  }

  /** The case, timed from INSIDE the slot: the turns it sent and the transcript
   * it read back, never the queue it waited in (`TURN_SECONDS_ATTRIBUTE`). */
  async #runCase(
    inputs: ExportedAgentInput, measured: TaskRunState | undefined,
  ): Promise<TranscriptResult> {
    const started = this.#milliseconds();
    const result = await this.#shape(await this.submitCase(inputs), inputs.locale);
    recordTurnSeconds(measured, (this.#milliseconds() - started) / 1000);
    return result;
  }

  #milliseconds(): number {
    return this.#settings.now?.() ?? performance.now();
  }

  async #shape(submitted: SubmittedCase, locale: string): Promise<TranscriptResult> {
    const { turn, sessionId, priorStreams } = submitted;
    return transcriptResultOf({
      frames: turnFramesOf(turn === null ? "" : await turn.text()),
      priorTrajectory: priorTurnReturns(priorStreams.map((stream) => turnFramesOf(stream))),
      history: sessionId === null ? null : await this.readTranscript(sessionId),
      locale,
    });
  }

  /** One submission, retried once when it never reached the app at all. */
  async #submit(body: ChatSubmission, locale: string, session: string | null): Promise<Response> {
    try {
      return await this.#post(body, locale, session);
    } catch (failure) {
      if (!(failure instanceof TransportFailure)) throw failure;
      return await this.#post(body, locale, session);
    }
  }

  async #post(body: ChatSubmission, locale: string, session: string | null): Promise<Response> {
    return await this.#through("/v1/chat", {
      method: "POST",
      headers: {
        ...(await this.#headers()),
        "Content-Type": "application/json",
        "x-turn-id": this.#settings.turnId(),
        "x-locale": locale,
        ...(session === null ? {} : { [SESSION_ID_HEADER]: session }),
      },
      body: JSON.stringify(body),
    });
  }

  /** The committed transcript, which is where a run's terminal status lives. */
  async readTranscript(session: string): Promise<GetSessionHistoryResponse | null> {
    const path = `/v1/conversations/${encodeURIComponent(session)}/messages`;
    const response = await this.#through(path, { headers: await this.#headers() });
    if (!response.ok) return null;
    return (await response.json()) as GetSessionHistoryResponse;
  }

  async #headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.#settings.bearer.current()}` };
  }

  /** Every request, through the door, under this run's per-turn budget. */
  async #through(path: string, init: RequestInit): Promise<Response> {
    const timeout = this.#settings.timeoutMs ?? TURN_TIMEOUT_MS;
    try {
      return await this.#settings.door(path, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch (failure) {
      throw new TransportFailure(path, failure);
    }
  }
}
