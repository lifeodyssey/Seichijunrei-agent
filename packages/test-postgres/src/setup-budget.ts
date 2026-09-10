/** Every wall-clock allowance one suite may spend getting its data plane up.
 *
 * ONE deadline covers the phases that can hang — the port bind and the
 * connection waits — rather than one timeout each. Three independent timeouts
 * was the bug #1318 found: 240 s for the bind plus 60 s per wait is 360 s
 * inside a 300 s hook, so a slow boot killed the lane instead of failing the
 * phase that overran. Here the phases share `deadlineMs`: the bind is capped by
 * all of it, and each wait by whatever the bind left behind.
 *
 * `chainMarginMs` is the room after those phases for the clean database and the
 * Atlas chain — a local socket with no network, seconds in practice — and the
 * room for an exhausted deadline to throw and be read as an error rather than
 * as a killed hook. `hookTimeoutMs` is their sum: what a `before` awaiting the
 * whole setup must allow.
 *
 * The two arms differ in exactly one number, and deliberately:
 * `workers/catalog`'s spike suite boots ONE container for the whole suite and
 * probes 30 × 1 s (#1324); `workers/edge`'s agent-db lane boots one PER FILE,
 * serially, so its first session can queue behind another boot and it keeps
 * 60 × 1 s (#1318). Do not harmonise them.
 */
import type { StartupWaitLimits } from "./postgres-startup-wait.ts";

export interface SetupBudget {
  /** One wall-clock deadline for the port bind and the connection waits together. */
  readonly deadlineMs: number;
  /** Ceiling on the first-session attempts, and the pause between them. */
  readonly firstSession: StartupWaitLimits;
  /** Room after the deadline's phases for the clean database and the Atlas chain. */
  readonly chainMarginMs: number;
}

/**
 * The published image is `linux/amd64`, so on an arm64 host the whole PostGIS
 * init runs under qemu (~62 s measured) — well past testcontainers' own 60 s
 * default on a container that was going to be fine.
 */
const DEADLINE_MS = 240_000;
const CHAIN_MARGIN_MS = 60_000;
const ATTEMPT_INTERVAL_MS = 1_000;

/** The catalog spike suite's budget: one container for every spike file. */
export const SPIKE_SETUP_BUDGET: SetupBudget = {
  deadlineMs: DEADLINE_MS,
  firstSession: { attemptCeiling: 30, pauseMs: ATTEMPT_INTERVAL_MS },
  chainMarginMs: CHAIN_MARGIN_MS,
};

/** The edge agent-db lane's budget: one container per lane fixture. */
export const AGENT_DB_SETUP_BUDGET: SetupBudget = {
  deadlineMs: DEADLINE_MS,
  firstSession: { attemptCeiling: 60, pauseMs: ATTEMPT_INTERVAL_MS },
  chainMarginMs: CHAIN_MARGIN_MS,
};

/** What a `before` hook awaiting the whole setup must allow. */
export function hookTimeoutMs(budget: SetupBudget): number {
  return budget.deadlineMs + budget.chainMarginMs;
}
