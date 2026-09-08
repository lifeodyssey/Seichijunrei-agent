import { useCallback, useState } from "react";
import type { RecomputeStatus } from "../components/SelectionTray";
import { isTurnActive } from "../lib/turn-gate";
import type { ChatSession } from "../use-chat-session";
import { useSelectionSettle } from "./use-selection-settle";
import type { SetSelectionStatus } from "./use-selection-settle";

/**
 * A selected-points selection turn (TURN-4 #955): the checkbox reselection
 * re-sends the conversation with `selected_point_ids`, which the server maps
 * onto the typed PointSelectionTurn — no model run, no bypass machinery. The
 * turn carries no new user utterance — the body field is the whole request
 * delta.
 */
export interface SelectedPointsBody {
  readonly selected_point_ids: readonly string[];
}

/** The selection can never fire empty: an empty selection produces no body. */
export function selectedPointsBody(ids: readonly string[]): SelectedPointsBody | undefined {
  if (ids.length === 0) return undefined;
  return { selected_point_ids: [...ids] };
}

/** Order-insensitive match of the live selection against the last-sent ids. */
export function sameIds(selected: ReadonlySet<string>, ids: readonly string[] | undefined): boolean {
  if (ids === undefined || selected.size !== ids.length) return false;
  return ids.every((id) => selected.has(id));
}

/**
 * Tracks the selection turn: `fire` sends the `selected_point_ids` body; the
 * settle watcher classifies the turn as idle again or failed. A failed
 * selection stays on the tray — ChatPage masks the full-page `TurnFailure`
 * surface while this hook reports `failed`.
 */
export interface RecomputeTurn {
  readonly status: RecomputeStatus;
  readonly lastSentIds: readonly string[] | undefined;
  readonly fire: (ids: readonly string[]) => void;
}

type SetIds = (ids: readonly string[]) => void;
type SendBypass = (body: SelectedPointsBody) => void;

/** The guards: an empty selection produces no body, and the shared status
 * gate (W1 #1220) refuses to fire while another turn is in flight. */
function fireRecompute(ids: readonly string[], active: boolean, send: SendBypass, setStatus: SetSelectionStatus, setIds: SetIds): void {
  const body = selectedPointsBody(ids);
  if (body === undefined || active) return;
  setIds(body.selected_point_ids);
  setStatus("busy");
  send(body);
}

function useFire(chat: ChatSession, setStatus: SetSelectionStatus, setIds: SetIds) {
  const { sendSelectedPoints, status } = chat;
  return useCallback(
    (ids: readonly string[]) => {
      fireRecompute(ids, isTurnActive(status), sendSelectedPoints, setStatus, setIds);
    },
    [sendSelectedPoints, status, setStatus, setIds],
  );
}

export function useRecomputeTurn(chat: ChatSession, sessionKey?: string): RecomputeTurn {
  const [status, setStatus] = useState<RecomputeStatus>("idle");
  const [lastSentIds, setLastSentIds] = useState<readonly string[]>();
  const [prevKey, setPrevKey] = useState(sessionKey);
  if (prevKey !== sessionKey) { setPrevKey(sessionKey); setStatus("idle"); setLastSentIds(undefined); }
  const fire = useFire(chat, setStatus, setLastSentIds);
  useSelectionSettle(status, chat, setStatus);
  return { status, lastSentIds, fire };
}
