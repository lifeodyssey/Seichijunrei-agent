import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { Locale } from "../../../i18n/locales";
import { ColdStart } from "./ColdStart";
import { DeparturePrompt } from "./DeparturePrompt";
import { ErrorBanner } from "./ErrorBanner";
import { SelectionTray } from "./SelectionTray";
import { TurnFailure } from "./ErrorStates/TurnFailure";
import type { TurnFailureView } from "./ErrorStates/TurnFailure";
import { HistoryList } from "./HistoryList";
import { MessageList } from "./MessageList";
import { WaitingRitual } from "./WaitingRitual";
import type { ChatEntryState } from "../entry-state";
import type { ChatDict } from "../i18n";
import { isTurnActive } from "../lib/turn-gate";
import type { RecomputeTurn } from "../selection/use-recompute-turn";
import type { DeparturePromptState } from "../use-departure-prompt";
import type { ConversationHistory } from "../use-conversation-history";
import type { ChatSession } from "../use-chat-session";
import { businessEventCount, useTurnTiming } from "../use-turn-timing";

/** The direction-E page frame: ChatPage assembles the seven regions it owns —
 * the mobile bar, the sidebar, the panel header, the notices, the body, the
 * dock surfaces, and the composer. */
export type ChatShellProps = Readonly<{
  appbar: ReactNode;
  sidebar: ReactNode;
  header: ReactNode;
  notices: ReactNode;
  body: ReactNode;
  dock: ReactNode;
  composer: ReactNode;
}>;

/** Mockup `body`: the leaf-green field with its leaf tile, sidebar beside the
 * cream panel. Mobile drops the padding and stacks the bar over the panel.
 * `lg:h-dvh` pins the desktop frame to the viewport, so a long conversation
 * scrolls the panel's body — never the page, the composer, or the sidebar. */
const SHELL_CLASS = "chat-page grid min-h-dvh gap-[22px] p-[22px] text-ground-ink [background-color:var(--color-ground)] [background-image:var(--leaf-tile-image)] [background-size:clamp(90px,18vw,260px)] max-lg:[grid-template-columns:1fr] max-lg:gap-0 max-lg:p-0 lg:h-dvh lg:[grid-template-columns:292px_1fr]";

/** Mockup `.main`: the cream panel with the ink outline and the hard ledge.
 * Flex column, not grid: the notices slot may render zero elements, and a
 * `1fr` grid row would hand the free space to the dock instead of the body. */
const PANEL_CLASS = "flex min-h-0 flex-col overflow-hidden rounded-3xl border-[3px] border-ground-ink bg-paper shadow-[0_6px_0_var(--shadow-3d)] max-lg:min-h-[calc(100dvh-62px)] max-lg:rounded-none max-lg:border-0 max-lg:shadow-none";

/** The conversation scroll region between the header and the dock; `flex-1`
 * makes the body — never the dock — absorb the panel's free space. */
const BODY_CLASS = "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-6 max-lg:px-5 max-lg:py-4";
const DOCK_CLASS = "min-h-0 overflow-y-auto";

function useScrollAnchor(itemCount: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [itemCount]);
  return ref;
}

type ChatNoticesProps = Readonly<{
  entry: ChatEntryState;
  onRetry: () => void;
  history: ConversationHistory;
  dict: ChatDict;
}>;

/** Owns the page-level banners: the A5 retry and the history error. */
export function ChatNotices({ entry, onRetry, history, dict }: ChatNoticesProps) {
  return (
    <>
      {entry === "A5" ? <ErrorBanner dict={dict} onRetry={onRetry} /> : null}
      {history.status === "error" ? <ErrorBanner dict={dict} onRetry={history.retry} message={dict.historyError} /> : null}
    </>
  );
}

type ChatIntroProps = Readonly<{
  entry: ChatEntryState;
  chat: ChatSession;
  history: ConversationHistory;
  dict: ChatDict;
  onSend: (text: string) => void;
}>;

function showColdStart(chat: ChatSession, history: ConversationHistory, entry: ChatEntryState): boolean {
  return chat.messages.length === 0 && history.entries.length === 0 && entry !== "A3";
}

/** Owns the pre-turn region: the history summary and the cold-start invite. */
export function ChatIntro({ entry, chat, history, dict, onSend }: ChatIntroProps) {
  return (
    <>
      {history.status === "loading" ? <p className="chat-history-loading" role="status" aria-busy="true">{dict.preparing}</p> : null}
      <HistoryList entries={history.entries} dict={dict} />
      {showColdStart(chat, history, entry) ? <ColdStart dict={dict} onChip={onSend} disabled={entry === "A5"} /> : null}
    </>
  );
}

type TurnStreamProps = Readonly<{
  chat: ChatSession;
  dict: ChatDict;
  failure: TurnFailureView | undefined;
  locale: Locale;
}>;

/** Owns the live-turn region: messages, the failure strip, the waiting ritual. */
export function TurnStream({ chat, dict, failure, locale }: TurnStreamProps) {
  const settledDurationMs = useTurnTiming(chat.status, businessEventCount(chat.messages));
  return (
    <>
      <MessageList messages={chat.messages} dict={dict} status={chat.status} settledDurationMs={settledDurationMs} />
      <TurnFailure view={failure} dict={dict} locale={locale} />
      <WaitingRitual status={chat.status} dict={dict} messages={chat.messages} />
    </>
  );
}

/** The a11y anchor, last in the chat body, keeps the live region announced in
 * order after the ritual. */
export function ScrollAnchor({ count }: Readonly<{ count: number }>) {
  const ref = useScrollAnchor(count);
  return <div ref={ref} aria-hidden="true" />;
}

/** Owns the whole frame: the green field, the sidebar and the panel that
 * carries the header, the conversation, the dock surfaces, and the composer. */
export function ChatShell({ appbar, sidebar, header, notices, body, dock, composer }: ChatShellProps) {
  return (
    <main className={SHELL_CLASS}>{appbar}{sidebar}<section className={PANEL_CLASS}>{header}{notices}<div className={BODY_CLASS}>{body}</div><div className={DOCK_CLASS}>{dock}</div>{composer}</section></main>
  );
}

/** C2t chips render only while a route request is held for departure info. */
export function DepartureGate({ departure, dict }: Readonly<{ departure: DeparturePromptState; dict: ChatDict }>) {
  if (departure.pending === null) return null;
  return <DeparturePrompt dict={dict} onChip={departure.onChip} onLocated={departure.onLocated} onManualLocation={departure.onManualLocation} />;
}

type DockTrayProps = Readonly<{
  dict: ChatDict;
  chat: ChatSession;
  recompute: RecomputeTurn;
}>;

/** P1-3: the tray must not fire while ANY turn is in flight — the AI SDK's
 * `makeRequest` has no concurrency guard, so a mid-stream tap would clobber
 * the active response. Chat busy always reads as `busy` here. */
function trayStatus(chat: ChatSession, recompute: RecomputeTurn): RecomputeTurn["status"] {
  return isTurnActive(chat.status) ? "busy" : recompute.status;
}

/** Owns the mid-dock surfaces: the busy live note and the E2 recompute tray.
 * Photo search lives in the composer now — the camera key opens the same flow. */
export function DockTray({ dict, chat, recompute }: DockTrayProps) {
  const status = trayStatus(chat, recompute);
  return (
    <>
      <span className="chat-live-note" aria-live="polite">{status === "busy" ? dict.preparing : ""}</span>
      <SelectionTray dict={dict} status={status} lastSentIds={recompute.lastSentIds} onRecompute={recompute.fire} />
    </>
  );
}
