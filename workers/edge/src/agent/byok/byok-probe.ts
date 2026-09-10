/**
 * One bounded probe of a caller's credential (W2-3 #1289) — the edge tier's
 * port of `interfaces/services/byok_probe.py` + `agents/byok_probe.py`.
 *
 * DUAL PURPOSE BY DESIGN (Python's OQ-2 ruling): one upstream request both
 * validates the credential and finds out whether the configured model accepts
 * an image part, so configuring a key costs the caller one probe rather than
 * two. That is why the probe message carries a 1×1 PNG — a model that rejects
 * images is reported as reachable-without-vision, not as broken.
 *
 * THE TAXONOMY IS DELIBERATELY COARSE, because a probe against a
 * caller-chosen endpoint is otherwise a reachability oracle for our egress:
 *   401 / 403      → `byok_credential_rejected` (the one actionable answer)
 *   400 / 422      → reachable, no vision (the model refused the image part)
 *   anything else  → `provider_unreachable`, including a throw, a timeout and
 *                    every other status. Nothing escapes as a fifth outcome.
 *
 * THE STATUS COMES OFF THE SOCKET, not off pi's error text. The guarded fetch
 * already owns the only path a provider request can take, so wrapping its
 * inner fetch is both the most direct reading and one that cannot drift with
 * an adapter's error formatting.
 *
 * THREE CONTAINMENTS, not one, exactly as `byok_probe.py`'s docstring lists
 * them: the coarse taxonomy above, a fixed wall-clock deadline, and a response
 * SIZE cap. The third is the one the guard does not already give — the
 * allowlist decides WHO answers, never how much they say — so a provider
 * having a bad day cannot stream unbounded data into a Worker whose memory is
 * shared with every other request on the isolate. The cap is on the PROBE and
 * not on `GuardedFetch`, because a real turn legitimately streams a long
 * answer; a probe never does.
 *
 * RESIDUAL, ACCEPTED AND NOT SOLVED (Python's issue #481, carried over): the
 * whole-probe deadline bounds how long a caller can wait, but failure LATENCY
 * below it still differs by cause, so a patient attacker can still time
 * open-vs-filtered across many probes.
 */
import type { Context, UserMessage } from "@earendil-works/pi-ai";
import type { ByokCredentialParts } from "./byok-credential.ts";
import { nativeByokModels } from "../host/native-models.ts";
import type { EgressPolicy } from "../egress/egress-policy.ts";
interface ByokEgress { readonly policy?: EgressPolicy; readonly inner?: typeof globalThis.fetch }

/** The `ByokProbeResponse` wire shape (`packages/contract/src/agent-contract.ts`). */
export interface ByokProbeVerdict {
  readonly vision: boolean;
  readonly reachable: boolean;
  readonly error_code: string | null;
}

/** The fixed wall-clock ceiling, ported from `_PROBE_TIMEOUT_SECONDS`. */
export const PROBE_TIMEOUT_MS = 5_000;

/** The response ceiling, ported from `CappedResponseTransport`'s 64 KiB. */
export const PROBE_RESPONSE_CAP_BYTES = 64 * 1024;

const PROBE_PROMPT = "reply with the single word OK";

/** A 1×1 transparent PNG — the same bytes `agents/byok_probe.py` sends. */
const PROBE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA" +
  "60e6kgAAAABJRU5ErkJggg==";

const CREDENTIAL_REJECTED = new Set([401, 403]);
const VISION_UNSUPPORTED = new Set([400, 422]);

const UNREACHABLE: ByokProbeVerdict = {
  vision: false,
  reachable: false,
  error_code: "provider_unreachable",
};

/** The model took the image part and answered — the whole point of sending one. */
const ANSWERED: ByokProbeVerdict = { vision: true, reachable: true, error_code: null };

function probeContext(): Context {
  const message: UserMessage = {
    role: "user",
    content: [
      { type: "text", text: PROBE_PROMPT },
      { type: "image", data: PROBE_PNG_BASE64, mimeType: "image/png" },
    ],
    timestamp: 0,
  };
  return { messages: [message] };
}

function verdictForStatus(status: number | null): ByokProbeVerdict {
  if (status === null) return UNREACHABLE;
  if (CREDENTIAL_REJECTED.has(status)) {
    return { vision: false, reachable: false, error_code: "byok_credential_rejected" };
  }
  return VISION_UNSUPPORTED.has(status)
    ? { vision: false, reachable: true, error_code: null }
    : UNREACHABLE;
}

/** Errors the stream past the cap rather than truncating it: a half-read
 * provider answer is not a shorter answer, it is a different one. */
function cappedBody(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > PROBE_RESPONSE_CAP_BYTES) throw new Error("probe response exceeded its cap");
      controller.enqueue(chunk);
    },
  }));
}

/** Exported because the cap is a named containment of this module, not an
 * incidental line: a test has to be able to hold it on its own. */
export function cappedResponse(response: Response): Response {
  // `Response.body` is typed `ReadableStream<any>` by the DOM lib; the runtime
  // only ever puts bytes on it, which is the one fact this narrowing asserts.
  const body = response.body as ReadableStream<Uint8Array> | null;
  return body === null ? response : new Response(cappedBody(body), response);
}

/** What one probe saw on the wire — the last upstream status, or none — and
 * the ceiling on how much of each answer it will read. */
class ProbeSocket {
  status: number | null = null;
  readonly #inner: typeof globalThis.fetch;

  constructor(inner: typeof globalThis.fetch) {
    this.#inner = inner;
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await this.#inner(input, init);
    this.status = response.status;
    return cappedResponse(response);
  };
}

export interface ByokProbeParts {
  readonly egress?: ByokEgress;
  readonly timeoutMs?: number;
}

export class ByokProbe {
  readonly #egress: ByokEgress;
  readonly #timeoutMs: number;

  constructor(parts: ByokProbeParts = {}) {
    this.#egress = parts.egress ?? {};
    this.#timeoutMs = parts.timeoutMs ?? PROBE_TIMEOUT_MS;
  }

  /** Never throws: every failure is one of the three verdicts above. */
  async run(credential: ByokCredentialParts): Promise<ByokProbeVerdict> {
    const socket = new ProbeSocket(this.#egress.inner ?? ((url, init) => fetch(url, init)));
    try {
      return await this.#completed(credential, socket);
    } catch {
      return verdictForStatus(socket.status);
    }
  }

  async #completed(credential: ByokCredentialParts, socket: ProbeSocket): Promise<ByokProbeVerdict> {
    const turn = await nativeByokModels(credential, socket.fetch);
    const signal = AbortSignal.timeout(this.#timeoutMs);
    const options = { maxRetries: 0, signal };
    const message = await turn.models.completeSimple(turn.model, probeContext(), options);
    const answered = message.stopReason !== "error" && message.stopReason !== "aborted";
    return answered ? ANSWERED : verdictForStatus(socket.status);
  }
}
