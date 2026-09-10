import { useCallback } from "react";
import { TURNSTILE_REQUIRED_CODE, classifyFailure } from "./lib/error-classifier";
import type { ChatErrorState, FailureSignal } from "./lib/error-classifier";
import { isTurnActive } from "./lib/turn-gate";
import type { AuthStatus } from "../../lib/auth/session";
import type { TurnFailureView } from "./components/ErrorStates/TurnFailure";
import { UNLOCKED, lockHolds, resetInstant, useQuotaRelease } from "./quota-lock";
import type { QuotaLock } from "./quota-lock";
import type { RecomputeTurn } from "./selection/use-recompute-turn";
import type { ChatSession } from "./use-chat-session";
import { useStreamRecovery } from "./use-stream-recovery";
import type { FailedStepResend } from "./use-stream-recovery";
import { useTurnTimeout } from "./use-turn-timeout";

function turnFailureSignal(lastStatus: number | undefined, code: string | undefined): FailureSignal {
  if (lastStatus !== undefined && lastStatus >= 400) return { kind: "http", status: lastStatus, code };
  return { kind: "stream-abort" };
}

/** Only the four fields classification reads — so it is testable without a
 * whole `useChat` instance, and cannot quietly grow a new dependency. */
export type FailingTurn = Pick<ChatSession, "status" | "error" | "lastErrorCode" | "lastHttpStatus">;

/**
 * A challenged turn is NOT D8 — an anonymous visitor never had a session to
 * expire — but the strip is only suppressed when a widget is actually on the
 * page to offer the recovery. A misconfigured build (no site key, or an edge
 * with no secret) rejects every turn with nothing to click, so there the
 * generic failure must still render rather than the chat dying silently
 * (issue #447 review, P1-3).
 */
function suppressedByChallenge(code: string | undefined, challenged: boolean): boolean {
  return challenged && code === TURNSTILE_REQUIRED_CODE;
}

export function turnFailureState(chat: FailingTurn, timedOut: boolean, challenged: boolean): ChatErrorState | undefined {
  if (isTurnActive(chat.status)) return undefined;
  if (timedOut) return "D5";
  if (chat.error === undefined) return undefined;
  const code = chat.lastErrorCode();
  if (suppressedByChallenge(code, challenged)) return undefined;
  return classifyFailure(turnFailureSignal(chat.lastHttpStatus(), code)) ?? "D4";
}

/**
 * The D12 lock, derived rather than stored: an authenticated identity is not
 * subject to the anonymous quota at all, so signing in releases the lock by
 * itself, and a `quota_resets_at` already in the past means a fresh quota day
 * began while the banner sat there — that identity starts the day at FULL
 * quota, so the lock must not outlive its own reset instant.
 */
export function quotaLockOf(
  chat: ChatSession,
  state: ChatErrorState | undefined,
  auth: AuthStatus,
  nowMs: number = Date.now(),
): QuotaLock {
  if (state !== "D12" || auth === "authenticated") return UNLOCKED;
  const lock = { locked: true, resetsAtMs: resetInstant(chat.lastQuotaResetsAt()) };
  return lockHolds(lock, nowMs) ? lock : UNLOCKED;
}

/** What the two gates need from the page: the armed challenge, and identity. */
export interface TurnFailureGate {
  readonly challenged: boolean;
  readonly auth: AuthStatus;
}

interface TurnFailure {
  readonly view: TurnFailureView | undefined;
  readonly quota: QuotaLock;
}

/** A released D12 stops being a failure at all — no banner, no lock. */
function surfacedState(state: ChatErrorState | undefined, quota: QuotaLock): ChatErrorState | undefined {
  return state === "D12" && !quota.locked ? undefined : state;
}

function useRelease(chat: ChatSession, quota: QuotaLock): void {
  const { clearError } = chat;
  useQuotaRelease(quota, useCallback(() => { clearError(); }, [clearError]));
}

type Timeout = ReturnType<typeof useTurnTimeout>;
type Recovery = ReturnType<typeof useStreamRecovery>;

/**
 * D16/D17 conflicts recover the latest session state — the client's view is
 * what went stale, so replaying the same request would only conflict again.
 * Every other retry re-sends the failed step (W1 #1220).
 */
export function retryRecoversLatest(state: ChatErrorState | undefined): boolean {
  return state === "D16" || state === "D17";
}

function useRecoveryHandlers(timeout: Timeout, recovery: Recovery, state: ChatErrorState | undefined) {
  const recoverForState = retryRecoversLatest(state) ? recovery.recoverLatest : recovery.recover;
  const onRetry = useCallback(() => { timeout.reset(); recoverForState(); }, [timeout, recoverForState]);
  const onExpiredResume = useCallback(() => { timeout.reset(); recovery.recoverExpired(); }, [timeout, recovery]);
  return { onRetry, onExpiredResume, recovering: recovery.recovering };
}

type Handlers = ReturnType<typeof useRecoveryHandlers>;

/** D18's honest copy names the failing code: the error code, else the bare status. */
function failingCodeOf(chat: ChatSession): string | undefined {
  const status = chat.lastHttpStatus();
  return chat.lastErrorCode() ?? (status === undefined ? undefined : String(status));
}

function failureOf(state: ChatErrorState | undefined, quota: QuotaLock, handlers: Handlers, errorCode: string | undefined): TurnFailure {
  if (state === undefined) return { view: undefined, quota };
  return { view: { state, quotaResetsAtMs: quota.resetsAtMs, errorCode, ...handlers }, quota };
}

/** Compose the D4-D18 view: watchdog + classification + per-state recovery. */
export function useTurnFailure(chat: ChatSession, gate: TurnFailureGate, failedPick?: FailedStepResend): TurnFailure {
  const timeout = useTurnTimeout(chat.status, () => void chat.stop(), chat.streamActivity);
  const recovery = useStreamRecovery(chat, chat.sessionIdOf, failedPick);
  const classified = turnFailureState(chat, timeout.timedOut, gate.challenged);
  const quota = quotaLockOf(chat, classified, gate.auth);
  const handlers = useRecoveryHandlers(timeout, recovery, classified);
  useRelease(chat, quota);
  return failureOf(surfacedState(classified, quota), quota, handlers, failingCodeOf(chat));
}

/**
 * The tray can recover only failures where an inline retry is meaningful.
 * D12 (quota lock), D13 (login journey), and D14 (key rejected, no retry)
 * must surface as full states even on recompute turns.
 */
export function maskRecomputeFailure(
  recompute: RecomputeTurn,
  failure: TurnFailureView | undefined,
): TurnFailureView | undefined {
  if (failure?.state === "D12" || failure?.state === "D13" || failure?.state === "D14") return failure;
  return recompute.status === "failed" ? undefined : failure;
}
