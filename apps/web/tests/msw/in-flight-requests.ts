import { server } from "./node";

/** What one case boundary did to the requests MSW had open across it. */
export interface DrainOutcome {
  /** Requests that finished being answered while the drain waited. */
  readonly settled: number;
  /** `METHOD url` of every request still unanswered when the drain returned. */
  readonly abandoned: readonly string[];
  /** How many the case said it would abandon, via `expectAbandonedRequests`. */
  readonly declared: number;
  /** The drain gave up on the bound instead of reaching its target. */
  readonly timedOut: boolean;
}

/**
 * The requests MSW has started but not yet finished answering.
 *
 * A case that ends while a turn is in flight hands the next case a live
 * request: MSW keeps resolving it across the boundary and the answer lands in
 * whatever the NEXT case is recording into, re-indexing every positional
 * assertion in it (issue #1503). Draining before `server.resetHandlers()`
 * closes that seam for every test file, including the ones that never learned
 * about it.
 *
 * `request:end` is the settle signal because it fires once the handler has
 * finished producing its answer — on every outcome (mocked, passthrough,
 * unhandled) and whether or not the client is still listening. The response
 * events settle too, for the paths that emit one without an end.
 *
 * A request that never settles (a handler pending by design, or one whose
 * client was unmounted before the drain ran) would otherwise burn the whole
 * bound in silence, so the drain stops as soon as only the DECLARED pending
 * requests remain and reports what it left behind.
 */
class InFlightRequests {
  readonly #open = new Map<string, string>();
  #declared = 0;
  #idle: (() => void) | undefined;

  start(requestId: string, label: string): void {
    this.#open.set(requestId, label);
  }

  settle(requestId: string): void {
    this.#open.delete(requestId);
    if (this.#open.size <= this.#declared) this.#idle?.();
  }

  declare(count: number): void {
    this.#declared = count;
  }

  async drain(timeoutMs: number): Promise<DrainOutcome> {
    const opened = this.#open.size;
    const declared = this.#declared;
    const timedOut = await this.#reachTarget(timeoutMs);
    const abandoned = [...this.#open.values()];
    this.#forget();
    return { settled: opened - abandoned.length, abandoned, declared, timedOut };
  }

  /** Resolves once only the declared pending requests are left; true if the bound won. */
  #reachTarget(timeoutMs: number): Promise<boolean> {
    if (this.#open.size <= this.#declared) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const bound = setTimeout(() => {
        resolve(true);
      }, timeoutMs);
      this.#idle = () => {
        clearTimeout(bound);
        resolve(false);
      };
    });
  }

  #forget(): void {
    this.#open.clear();
    this.#declared = 0;
    this.#idle = undefined;
  }
}

const inFlight = new InFlightRequests();

server.events.on("request:start", ({ requestId, request }) => {
  inFlight.start(requestId, `${request.method} ${request.url}`);
});
server.events.on("request:end", ({ requestId }) => {
  inFlight.settle(requestId);
});
server.events.on("response:mocked", ({ requestId }) => {
  inFlight.settle(requestId);
});
server.events.on("response:bypass", ({ requestId }) => {
  inFlight.settle(requestId);
});
server.events.on("unhandledException", ({ requestId }) => {
  inFlight.settle(requestId);
});

const NOTHING_IN_FLIGHT: DrainOutcome = { settled: 0, abandoned: [], declared: 0, timedOut: false };
let closedTheLastCase: DrainOutcome = NOTHING_IN_FLIGHT;

/** Await every in-flight mocked request the live case did not declare, bounded. */
export async function drainInFlightRequests(timeoutMs = 2000): Promise<DrainOutcome> {
  closedTheLastCase = await inFlight.drain(timeoutMs);
  return closedTheLastCase;
}

/** The drain that closed the previous case — how a test reads the harness's own work. */
export function lastDrainOutcome(): DrainOutcome {
  return closedTheLastCase;
}

/**
 * Declare that the live case ends with `count` request(s) still unanswered.
 *
 * Only for handlers that are pending BY DESIGN — a case asserting a loading or
 * "still verifying" state. It is also what keeps the drain fast: it returns as
 * soon as the declared number is all that is left, instead of waiting the bound.
 */
export function expectAbandonedRequests(count: number): void {
  inFlight.declare(count);
}

/** Every abandonment was declared, and the drain never had to wait out its bound. */
export function assertCleanBoundary(outcome: DrainOutcome): void {
  const left = outcome.abandoned.join(", ");
  if (outcome.timedOut) throw new Error(`msw drain: waited out the bound with ${left} still unanswered.`);
  if (outcome.abandoned.length === outcome.declared) return;
  throw new Error(
    `msw drain: this case abandoned ${String(outcome.abandoned.length)} request(s) but declared ` +
      `${String(outcome.declared)}: ${left}. Await the turn, or call expectAbandonedRequests(n) ` +
      `if the handler is pending by design.`,
  );
}
