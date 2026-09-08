import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { RecomputeStatus } from "../components/SelectionTray";
import { isTurnActive } from "../lib/turn-gate";
import type { ChatSession } from "../use-chat-session";
import type { CandidatePick } from "./candidate-pick";
import { useSelectionSettle } from "./use-selection-settle";
import type { SetSelectionStatus } from "./use-selection-settle";

/**
 * The channel a clarify-candidate pick travels on. `useClarifyPickState` below
 * is the session's implementation (W1 #1220): `pick` fires the structured
 * selection through the deterministic channel, the shared settle watcher
 * reports it settled or failed, and `resend` retries the failed pick itself
 * (same message, same idempotency key) instead of replaying history — a failed
 * pick re-arms the clarify card through `status`. A photo result supplies its
 * own implementation instead (`photo-offer-pick.ts`), which confirms the
 * sessionless offer and reports no failure state of its own.
 */
export interface ClarifyPickTurn {
  /** Whether a structured selection channel is wired at all. */
  readonly enabled: boolean;
  /** The shared status gate's verdict: may a send fire right now? */
  readonly sendable: boolean;
  readonly status: RecomputeStatus;
  readonly lastPick: CandidatePick | undefined;
  readonly pick: (pick: CandidatePick) => void;
  readonly resend: () => void;
}

/** Outside a pick scope (history rows, bare card tests) picks fall back to free text. */
const DISABLED_PICK: ClarifyPickTurn = {
  enabled: false,
  sendable: true,
  status: "idle",
  lastPick: undefined,
  pick: () => undefined,
  resend: () => undefined,
};

const ClarifyPickContext = createContext<ClarifyPickTurn>(DISABLED_PICK);

type SetPick = (pick: CandidatePick) => void;

function firePick(chat: ChatSession, setStatus: SetSelectionStatus, setLastPick: SetPick, pick: CandidatePick) {
  if (isTurnActive(chat.status)) return;
  setLastPick(pick);
  setStatus("busy");
  chat.sendCandidatePick(pick);
}

function usePick(chat: ChatSession, setStatus: SetSelectionStatus, setLastPick: SetPick) {
  return useCallback(
    (pick: CandidatePick) => { firePick(chat, setStatus, setLastPick, pick); },
    [chat, setStatus, setLastPick],
  );
}

function useResend(chat: ChatSession, lastPick: CandidatePick | undefined, setStatus: SetSelectionStatus) {
  const { resendCandidatePick, status } = chat;
  return useCallback(() => {
    if (lastPick === undefined || isTurnActive(status)) return;
    setStatus("busy");
    resendCandidatePick(lastPick);
  }, [resendCandidatePick, status, lastPick, setStatus]);
}

/** The live pick turn; owned by ChatPage, shared through the provider. */
function usePickTurnState(sessionKey?: string) {
  const [status, setStatus] = useState<RecomputeStatus>("idle");
  const [lastPick, setLastPick] = useState<CandidatePick>();
  const [prevKey, setPrevKey] = useState(sessionKey);
  if (prevKey !== sessionKey) { setPrevKey(sessionKey); setStatus("idle"); setLastPick(undefined); }
  return { status, setStatus, lastPick, setLastPick };
}

/** The live pick turn; owned by ChatPage, shared through the provider. */
export function useClarifyPickState(chat: ChatSession, sessionKey?: string): ClarifyPickTurn {
  const { status, setStatus, lastPick, setLastPick } = usePickTurnState(sessionKey);
  const pick = usePick(chat, setStatus, setLastPick);
  const resend = useResend(chat, lastPick, setStatus);
  useSelectionSettle(status, chat, setStatus);
  const sendable = !isTurnActive(chat.status);
  return useMemo(() => ({ enabled: true, sendable, status, lastPick, pick, resend }), [sendable, status, lastPick, pick, resend]);
}

type ProviderProps = Readonly<{ turn: ClarifyPickTurn; children: ReactNode }>;

export function ClarifyPickProvider({ turn, children }: ProviderProps) {
  return <ClarifyPickContext.Provider value={turn}>{children}</ClarifyPickContext.Provider>;
}

export function useClarifyPick(): ClarifyPickTurn {
  return useContext(ClarifyPickContext);
}
