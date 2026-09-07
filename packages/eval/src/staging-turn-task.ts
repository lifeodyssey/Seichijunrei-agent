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
import { setEvalAttribute } from "logfire/evals";
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
 * It is set from the TASK and not from `CaseLifecycle.setup()`, because
 * `setEvalAttribute` writes into the case's own task-run context and the driver
 * opens that context around the task only (`logfire/evals`' case runner). What
 * the task knows is exactly what the attribute means: this case's turns ran on
 * a session somebody had already put a starting point in.
 */
export const PREFIX_SEEDED_ATTRIBUTE = "prefix_seeded";

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

  /** One case: its recorded history replayed, then the turn under measurement. */
  run(inputs: ExportedAgentInput): Promise<TranscriptResult> {
    return this.#inFlight.enter(() => this.#runCase(inputs));
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

  /** The session this case's prefix was seeded into, marked on the report so a
   * reader can tell a case that started from a frozen prefix from one that did
   * not. `null` is a case with no prefix, which starts where it always did. */
  #seededSession(inputs: ExportedAgentInput): string | null {
    const seeded = this.#settings.sessions?.of(inputs) ?? null;
    if (seeded !== null) setEvalAttribute(PREFIX_SEEDED_ATTRIBUTE, true);
    return seeded;
  }

  async #runCase(inputs: ExportedAgentInput): Promise<TranscriptResult> {
    return this.#shape(await this.submitCase(inputs), inputs.locale);
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
