import type { ChatStatus } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** A view with no transport activity eventually offers reconnect. Native execution has no browser deadline. */
export const TURN_TIMEOUT_MS = 110_000;

export interface TurnTimeout {
  readonly timedOut: boolean;
  readonly reset: () => void;
}

function isActiveTurn(status: ChatStatus): boolean {
  return status === "submitted" || status === "streaming";
}

function armWatchdog(stopRef: RefObject<() => void>, setTimedOut: (value: boolean) => void): () => void {
  setTimedOut(false);
  const id = setTimeout(() => { setTimedOut(true); stopRef.current(); }, TURN_TIMEOUT_MS);
  return () => { clearTimeout(id); };
}

/** Heartbeat bytes renew this idle watchdog; stopping releases only the client view. */
export function useTurnTimeout(status: ChatStatus, stop: () => void, activity = 0): TurnTimeout {
  const [timedOut, setTimedOut] = useState(false);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const active = isActiveTurn(status);
  useEffect(() => (active ? armWatchdog(stopRef, setTimedOut) : undefined), [active, activity]);
  const reset = useCallback(() => { setTimedOut(false); }, []);
  return { timedOut, reset };
}
