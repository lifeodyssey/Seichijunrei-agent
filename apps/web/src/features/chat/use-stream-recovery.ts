import { useCallback, useState } from "react";
import type { ChatRequestOptions } from "ai";
import { clearAuthToken } from "../../lib/auth/auth-session";

export interface StreamRecovery {
  readonly recover: () => void;
  readonly recoverLatest: () => void;
  readonly recoverExpired: () => void;
  readonly recovering: boolean;
}

export interface RecoverableChat {
  readonly clearError: () => void;
  readonly regenerate: () => Promise<void>;
  readonly resumeStream: (options?: ChatRequestOptions) => Promise<void>;
}

/** Structured selection retries retain their own typed request key. */
export interface FailedStepResend {
  readonly failed: boolean;
  readonly resend: () => void;
}

interface RecoveryRun {
  readonly chat: RecoverableChat;
  readonly sessionId: string | undefined;
  readonly setRecovering: (value: boolean) => void;
  readonly latest: boolean;
}

function runRecovery({ chat, sessionId, setRecovering, latest }: RecoveryRun): void {
  chat.clearError();
  if (!sessionId) { void chat.regenerate(); return; }
  setRecovering(true);
  void chat.resumeStream({ metadata: { latest } }).then(
    () => { setRecovering(false); }, () => { setRecovering(false); },
  );
}

function useNativeRecovery(chat: RecoverableChat, sessionIdOf: () => string | undefined) {
  const [recovering, setRecovering] = useState(false);
  const resume = useCallback((latest: boolean) => {
    runRecovery({ chat, sessionId: sessionIdOf(), setRecovering, latest });
  }, [chat, sessionIdOf]);
  const recoverOperation = useCallback(() => { resume(false); }, [resume]);
  const recoverLatest = useCallback(() => { resume(true); }, [resume]);
  return { recoverOperation, recoverLatest, recovering };
}

/** The SDK replaces the current assistant message from a native snapshot, then consumes live events. */
export function useStreamRecovery(chat: RecoverableChat, sessionIdOf: () => string | undefined, failedPick?: FailedStepResend): StreamRecovery {
  const { recoverOperation, recoverLatest, recovering } = useNativeRecovery(chat, sessionIdOf);
  const recover = useRecoverFailedStep(recoverOperation, failedPick);
  return { recover, recoverLatest, recoverExpired: useRecoverExpired(recoverLatest), recovering };
}

function useRecoverExpired(recoverLatest: () => void) {
  return useCallback(() => { clearAuthToken(); recoverLatest(); }, [recoverLatest]);
}

function useRecoverFailedStep(recoverOperation: () => void, failedPick: FailedStepResend | undefined) {
  return useCallback(() => {
    if (failedPick?.failed === true) { failedPick.resend(); return; }
    recoverOperation();
  }, [recoverOperation, failedPick]);
}
