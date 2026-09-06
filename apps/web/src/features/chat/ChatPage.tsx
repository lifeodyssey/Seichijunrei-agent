import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocale } from "../../i18n/LocaleProvider";
import type { Locale } from "../../i18n/locales";
import { useAuthStatus } from "../../lib/auth/session";
import { ChatActionsProvider, sendWithOriginOf } from "./ChatActions";
import type { ChatActions } from "./ChatActions";
import { ChatIntro, ChatNotices, ChatShell, DepartureGate, DockTray, ScrollAnchor, TurnStream } from "./components/ChatShell";
import { ChatAppBar } from "./components/ChatAppBar";
import { ChatHeader } from "./components/ChatHeader";
import { ChatSidebar } from "./components/ChatSidebar";
import { ComposerDock } from "./components/ComposerDock";
import type { ComposerGate } from "./components/ComposerDock";
import { currentChatConfig } from "./config";
import { deriveEntryState, resolveRouteReference } from "./entry-state";
import type { ChatEntryState } from "./entry-state";
import { chatDictFor } from "./i18n";
import type { ChatDict } from "./i18n";
import type { PhotoGps, PhotoSearchContext } from "./photo-search";
import type { ChatSearch } from "./search";
import { SpotSelectionProvider, useSpotSelectionState } from "./selection/use-spot-selection";
import { ClarifyPickProvider, useClarifyPickState } from "./selection/use-clarify-pick";
import type { ClarifyPickTurn } from "./selection/use-clarify-pick";
import { useRecomputeTurn } from "./selection/use-recompute-turn";
import type { RecomputeTurn } from "./selection/use-recompute-turn";
import { gatedTurnEntry } from "./lib/turn-gate";
import { lockedClarifyPick, lockedRecompute, useLockedActions } from "./quota-lock";
import type { QuotaLock } from "./quota-lock";
import { useAutoSend } from "./use-auto-send";
import { useDeparturePrompt } from "./use-departure-prompt";
import type { DeparturePromptState } from "./use-departure-prompt";
import { useBackendHealth } from "./use-backend-health";
import type { BackendHealth } from "./use-backend-health";
import type { ChatSession } from "./use-chat-session";
import { useChatSession } from "./use-chat-session";
import { useConversationHistory } from "./use-conversation-history";
import type { ConversationHistory } from "./use-conversation-history";
import { maskRecomputeFailure, useTurnFailure } from "./use-turn-failure";
import type { TurnFailureGate } from "./use-turn-failure";
import type { TurnFailureView } from "./components/ErrorStates/TurnFailure";
import { ChatReturnTargetProvider } from "./ChatReturnTarget";
import { assignedSessionId, useChatEntry, usePublishSessionId } from "./conversation-address";
import { useAgentWarmup } from "../../lib/agent-warmup";

export interface ChatPageProps {
  readonly search: ChatSearch;
}

/** The shared status gate (W1 #1220) applied to the text entry points: a
 * send fired while a turn is in flight is dropped, never raced. */
function useGatedSends(chat: ChatSession) {
  const { sendMessage, status } = chat;
  const send = useMemo(() => gatedTurnEntry(status, (text: string) => {
    void sendMessage({ text });
  }), [sendMessage, status]);
  const sendWithOrigin = useMemo(() => gatedTurnEntry(status, (text: string, lat: number, lng: number) => {
    void sendMessage({ text }, { body: { origin_lat: lat, origin_lng: lng } });
  }), [sendMessage, status]);
  return { send, sendWithOrigin };
}

/** Send, plus the D6-style retry: drop the failed turn's partial and resubmit. */
function useTurnActions(chat: ChatSession): ChatActions {
  const { clearError, regenerate } = chat;
  const { send, sendWithOrigin } = useGatedSends(chat);
  const regen = useCallback(() => { clearError(); void regenerate(); }, [clearError, regenerate]);
  return useMemo(() => ({ send, regenerate: regen, sendWithOrigin }), [send, regen, sendWithOrigin]);
}

function makeTracked(actions: ChatActions, setGps: (gps: PhotoGps) => void): ChatActions {
  return {
    ...actions,
    sendWithOrigin: (text: string, lat: number, lng: number) => {
      setGps({ lat, lng });
      sendWithOriginOf(actions)(text, lat, lng);
    },
  };
}

/** Remember granted C4 coordinates so photo search can reuse them (AC6). */
function useOriginTracking(actions: ChatActions): { actions: ChatActions; gps: PhotoGps | undefined } {
  const [gps, setGps] = useState<PhotoGps | undefined>(undefined);
  const tracked = useMemo(() => makeTracked(actions, setGps), [actions]);
  return { actions: tracked, gps };
}

/** A5 covers backend reachability only; stream failures render inline D-strips. */
function entryStateOf(search: ChatSearch, health: BackendHealth): ChatEntryState {
  return deriveEntryState({
    healthy: health.status !== "down",
    query: search.q,
    sessionId: search.session,
    routeReference: resolveRouteReference(search.route),
  });
}

function useAutoSendFromQuery(search: ChatSearch, health: BackendHealth, send: (text: string) => void) {
  useAutoSend({
    query: search.q,
    enabled: health.healthy && !search.session,
    send,
    sessionId: search.session,
  });
}

/** The conversation this page shows, including its address: the id the backend
 * assigns to a fresh draft is published into `?session=` (#1337). */
function useChatState(entry: ChatSearch) {
  const config = useMemo(currentChatConfig, []);
  const health = useBackendHealth(config.baseUrl);
  const chat = useChatSession(config.chatUrl, entry.session);
  const history = useConversationHistory(config.baseUrl, entry.session);
  usePublishSessionId(entry, assignedSessionId(chat.messages));
  return { config, health, chat, history };
}

/** Photo requests share chat's identity: locale, live session id, C4 gps. */
function usePhotoContext(locale: ReturnType<typeof useLocale>, chat: ChatSession, gps: PhotoGps | undefined): PhotoSearchContext {
  return useMemo(
    () => ({ locale, sessionIdOf: chat.sessionIdOf, gps }),
    [locale, chat.sessionIdOf, gps],
  );
}

/** A failed pick's resend, in the shape the recovery flow consumes. */
function useFailedPick(clarifyPick: ClarifyPickTurn) {
  const { status, resend } = clarifyPick;
  return useMemo(() => ({ failed: status === "failed", resend }), [status, resend]);
}

/** Tray state: the recompute + clarify-pick turns, their masked failure, and the spot store. */
function useTrayState(chat: ChatSession, baseUrl: string, gate: TurnFailureGate, sessionKey: string | undefined) {
  const clarifyPick = useClarifyPickState(chat, sessionKey);
  const turn = useTurnFailure(chat, baseUrl, gate, useFailedPick(clarifyPick));
  const recompute = useRecomputeTurn(chat, sessionKey);
  const failure = maskRecomputeFailure(recompute, turn.view);
  const selection = useSpotSelectionState(sessionKey);
  const locked = turn.quota.locked;
  return { recompute: lockedRecompute(recompute, locked), clarifyPick: lockedClarifyPick(clarifyPick, locked), failure, selection, quota: turn.quota };
}

/** Locale-bound page copy plus the photo/departure surfaces that share it. */
function usePageSurfaces(chat: ChatSession, actions: ChatActions, gps: PhotoGps | undefined) {
  const locale = useLocale();
  const dict = chatDictFor(locale);
  const photo = usePhotoContext(locale, chat, gps);
  const departure = useDeparturePrompt(actions, dict);
  return { dict, photo, departure, locale };
}

function useGuardedTray(chat: ChatSession, baseUrl: string, auth: ReturnType<typeof useAuthStatus>, sessionKey: string | undefined) {
  return useTrayState(chat, baseUrl, { challenged: false, auth }, sessionKey);
}

function useChatPage(entry: ChatSearch) {
  const { config, health, chat, history } = useChatState(entry);
  const { actions: live, gps } = useOriginTracking(useTurnActions(chat));
  const auth = useAuthStatus();
  const tray = useGuardedTray(chat, config.baseUrl, auth, entry.session);
  const actions = useLockedActions(live, tray.quota.locked);
  const surfaces = usePageSurfaces(chat, actions, gps);
  useAutoSendFromQuery(entry, health, actions.send);
  return { config, health, chat, history, actions, auth, ...surfaces, ...tray };
}

type PageState = ReturnType<typeof useChatPage>;

/** What the composer is allowed to do this render (spec group G): A5 and the
 * A3 history gate take the field away, a running turn only takes the send key,
 * and a failed turn owes the visitor their words back. */
function composerGateOf(entry: ChatEntryState, chat: ChatSession, history: ConversationHistory, failure: TurnFailureView | undefined): ComposerGate {
  const historyBlocked = entry === "A3" && history.status !== "success";
  return {
    locked: entry === "A5" || historyBlocked,
    busy: chat.status === "submitted" || chat.status === "streaming",
    failed: failure !== undefined,
  };
}

/** Plain page-level assembly (not a component): the `.chat-body` order spans
 * three regions whose state union exceeds the component prop ceiling. */
function chatBody(entry: ChatEntryState, chat: ChatSession, history: ConversationHistory, dict: ChatDict, onSend: (text: string) => void, failure: TurnFailureView | undefined, locale: Locale): ReactNode {
  return (
    <>
      <ChatIntro entry={entry} chat={chat} history={history} dict={dict} onSend={onSend} />
      <TurnStream chat={chat} dict={dict} failure={failure} locale={locale} />
      <ScrollAnchor count={history.entries.length + chat.messages.length} />
    </>
  );
}

/** Plain page-level assembly: the dock surfaces above the composer. */
function chatDock(departure: DeparturePromptState, dict: ChatDict, chat: ChatSession, recompute: RecomputeTurn): ReactNode {
  return (
    <>
      <DepartureGate departure={departure} dict={dict} />
      <DockTray dict={dict} chat={chat} recompute={recompute} />
    </>
  );
}

/** Plain page-level assembly: the direction-E composer dock (camera key, gold
 * send, and the hint line) with its current send gate. */
function chatComposer(dict: ChatDict, baseUrl: string, photo: PhotoSearchContext, quota: QuotaLock, onSend: (text: string) => void, gate: ComposerGate): ReactNode {
  return <ComposerDock dict={dict} baseUrl={baseUrl} photo={photo} gate={gate} quotaLocked={quota.locked} onSend={onSend} />;
}

function shellProps(search: ChatSearch, page: PageState, entry: ChatEntryState, gate: ComposerGate) {
  const chrome = {
    appbar: <ChatAppBar dict={page.dict} status={page.auth} />,
    sidebar: <ChatSidebar dict={page.dict} status={page.auth} baseUrl={page.config.baseUrl} activeSessionId={search.session} />,
    header: <ChatHeader dict={page.dict} />,
    notices: <ChatNotices entry={entry} onRetry={page.health.retry} history={page.history} dict={page.dict} />,
  };
  return { ...chrome, body: chatBody(entry, page.chat, page.history, page.dict, page.departure.onSend, page.failure, page.locale), dock: chatDock(page.departure, page.dict, page.chat, page.recompute), composer: chatComposer(page.dict, page.config.baseUrl, page.photo, page.quota, page.departure.onSend, gate) };
}

function ChatPageView({ search, page }: Readonly<{ search: ChatSearch; page: PageState }>) {
  const entry = entryStateOf(search, page.health);
  const gate = composerGateOf(entry, page.chat, page.history, page.failure);
  return <ChatShell {...shellProps(search, page, entry, gate)} />;
}

/** Publishes the live session id so every in-chat login wall and the settings
 * link can send the visitor back to this conversation (#507 review P1-1). */
function withReturnTarget(entry: ChatSearch, page: PageState) {
  return (
    <ChatReturnTargetProvider sessionIdOf={page.chat.sessionIdOf}>
      <ChatPageView search={entry} page={page} />
    </ChatReturnTargetProvider>
  );
}

/** The provider stack around the page view: spot selection, clarify pick, actions. */
function withProviders(entry: ChatSearch, page: PageState) {
  return (
    <SpotSelectionProvider selection={page.selection}>
      <ClarifyPickProvider turn={page.clarifyPick}>
        <ChatActionsProvider actions={page.actions}>{withReturnTarget(entry, page)}</ChatActionsProvider>
      </ClarifyPickProvider>
    </SpotSelectionProvider>
  );
}

export function ChatPage(props: ChatPageProps) {
  useAgentWarmup();
  const entry = useChatEntry(props.search);
  return withProviders(entry, useChatPage(entry));
}
