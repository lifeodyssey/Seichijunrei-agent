import type { ChangeEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readChatDraft, writeChatDraft } from "../lib/draft-storage";
import type { ChatDict } from "../i18n";
import { QUOTA_BANNER_ID } from "./ErrorStates/QuotaExhausted";

type Props = Readonly<{
  dict: ChatDict;
  /** A5 / A3: the composer is out of service — the field itself is withheld. */
  disabled: boolean;
  /** G4: a turn is running. The field stays live; only the send key is withheld. */
  busy?: boolean;
  /** D12 (#282 S1.10): the visitor's daily message quota is spent. */
  quotaLocked?: boolean;
  /** G5: the turn that just left failed, so its text belongs back in the field. */
  sendFailed?: boolean;
  /** The camera trigger (photo search) rendered inside the pill's left edge. */
  leading?: ReactNode;
  onSend: (text: string) => void;
}>;

type Submittable = Readonly<{ preventDefault: () => void }>;

/** Mockup `.input-wrap`: the wide rounded composer pill on cream. Focus swaps
 * the ink edge for teal and keeps the hard ledge — no glow stack. The deep
 * teal reads 4.1:1 on the day card; at night the bright teal takes over
 * (7.4:1) because the deep one falls under WCAG 1.4.11's 3:1 state floor. */
const PILL_CLASS = "flex w-full items-center gap-1.5 rounded-full border-[3px] border-ground-ink bg-card py-2 pe-2.5 ps-2 text-ground-ink shadow-[0_5px_0_var(--shadow-3d)] transition-[border-color,box-shadow,opacity] duration-150 focus-within:border-primary-strong night:focus-within:border-primary";

function useDraftPersistence(text: string): void {
  useEffect(() => { writeChatDraft(text); }, [text]);
}

/** Only ever wired when the send is allowed, so the emptiness check that would
 * belong here lives in `sendWithheld` instead — one owner for one rule. */
function makeSubmit(text: string, commit: (sent: string) => void) {
  return (event: Submittable) => {
    event.preventDefault();
    commit(text.trim());
  };
}

/** G5: a failed turn took the visitor's words with it — put the trimmed payload
 * that `makeSubmit` handed off back in the field rather than making the visitor
 * retype. Assigning the value is what parks the caret at the end (HTML: setting
 * `value` collapses the selection there). */
function useFailedSendRefill(sendFailed: boolean, sent: { current: string }, setText: (text: string) => void) {
  useEffect(() => {
    if (!sendFailed || sent.current === "") return;
    setText(sent.current);
    sent.current = "";
  }, [sendFailed, sent, setText]);
}

/** The send itself: hand the text to the turn, clear the field, and remember
 * what left, because G5 may have to put it back. */
function useMessageHandoff(onSend: (text: string) => void, sent: { current: string }, setText: (text: string) => void) {
  return useCallback((value: string) => {
    sent.current = value;
    setText("");
    onSend(value);
  }, [onSend, sent, setText]);
}

function useComposer(onSend: (text: string) => void, sendFailed: boolean) {
  const [text, setText] = useState(readChatDraft);
  const sent = useRef("");
  const change = useCallback((event: ChangeEvent<HTMLInputElement>) => { setText(event.target.value); }, []);
  const commit = useMessageHandoff(onSend, sent, setText);
  useDraftPersistence(text);
  useFailedSendRefill(sendFailed, sent, setText);
  return { text, change, submit: useMemo(() => makeSubmit(text, commit), [text, commit]) };
}

/** D12 swallows the submit instead of clearing: the draft is the visitor's. */
function blockSubmit(event: Submittable) {
  event.preventDefault();
}

function placeholderFor(dict: ChatDict, quotaLocked: boolean, busy: boolean): string {
  if (quotaLocked) return dict.errorStates.d12InputHint;
  return busy ? dict.busyPlaceholder : dict.inputPlaceholder;
}

/** G3: the send key answers the field. Nothing to send, nothing to press. */
function sendWithheld(text: string, disabled: boolean, busy: boolean, quotaLocked: boolean): boolean {
  return disabled || busy || quotaLocked || text.trim() === "";
}

/** The mockup `.send`: a gold disc with an up-arrow, an ink ring, and a ledge. */
function SendGlyph() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="var(--color-gold-ink)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

/* The send disc is the library's 3D-press `primary` button rethemed onto our
 * tokens: `bg-gold` stays on the element (the composer test pins it) and beats
 * the package's components-layer fill, while the ledge vars ride `--shadow-3d`
 * so the press depth flips with the theme. The muted disabled face stays ours —
 * the package's disabled fade (opacity only) cannot speak it. */
const SEND_PRESS = "[--animal-shadow-press:0_3px_0_0_var(--shadow-3d)] [--animal-shadow-press-hover:0_4px_0_0_var(--shadow-3d)] [--animal-shadow-press-active:0_1px_0_0_var(--shadow-3d)]";
const SEND_CLASS = `animal-btn animal-btn-primary size-[46px] flex-none border-[3px] border-ground-ink bg-gold focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ground-ink disabled:border-ground-ink/40 disabled:bg-muted disabled:shadow-none ${SEND_PRESS}`;

/** G3: the round gold key goes flat and muted when there is nothing to send. */
function SendKey({ dict, withheld }: Readonly<{ dict: ChatDict; withheld: boolean }>) {
  return (
    <button type="submit" className={SEND_CLASS} aria-label={dict.send} disabled={withheld}>
      <SendGlyph />
    </button>
  );
}

type FieldProps = Readonly<{
  dict: ChatDict; disabled: boolean; busy: boolean; quotaLocked: boolean;
  text: string; onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}>;

/** The field disappears into the pill; the pill draws the focus ring. */
const FIELD_CLASS = "min-h-11 flex-1 min-w-0 border-0 bg-transparent text-[16.5px] font-bold text-ground-ink outline-none placeholder:text-ground-ink/40";

/**
 * The accessible NAME stays the ordinary placeholder in every state — a field
 * whose name changes to "sign in to send this" is a different control to a
 * screen reader. The reason is exposed as a DESCRIPTION instead, pointed at the
 * D12 banner that is already on screen and already announced as an alert.
 */
function ComposerField({ dict, disabled, busy, quotaLocked, text, onChange }: FieldProps) {
  const describedby = quotaLocked ? QUOTA_BANNER_ID : undefined;
  return (
    <input className={FIELD_CLASS} autoFocus value={text} onChange={onChange} disabled={disabled} aria-label={dict.inputPlaceholder} placeholder={placeholderFor(dict, quotaLocked, busy)} aria-describedby={describedby} />
  );
}

function pillClassOf(busy: boolean): string {
  return busy ? `${PILL_CLASS} opacity-75` : PILL_CLASS;
}

/**
 * G4's rule generalised for D12 (#282 S1.10): a running turn and a quota lock
 * both keep the composer editable and keep whatever is already typed — only the
 * send path is withheld, and the placeholder says why. G4 dims the pill, it
 * does not remove it.
 */
export function ChatInput({ dict, disabled, busy = false, quotaLocked = false, sendFailed = false, leading, onSend }: Props) {
  const composer = useComposer(onSend, sendFailed);
  const withheld = sendWithheld(composer.text, disabled, busy, quotaLocked);
  const submit = withheld ? blockSubmit : composer.submit;
  const field = <ComposerField dict={dict} disabled={disabled} busy={busy} quotaLocked={quotaLocked} text={composer.text} onChange={composer.change} />;
  return (
    <form className={pillClassOf(busy)} onSubmit={submit}>{leading}{field}<SendKey dict={dict} withheld={withheld} /></form>
  );
}
