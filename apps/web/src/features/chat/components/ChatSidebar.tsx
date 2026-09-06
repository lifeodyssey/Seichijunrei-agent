import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "animal-island-ui-tailwind/button";
import { LoginModal } from "../../auth/ui/LoginModal";
import type { AuthStatus } from "../../../lib/auth/session";
import { chatSessionTarget, useChatReturnTarget, useChatSessionId } from "../ChatReturnTarget";
import type { ChatDict } from "../i18n";
import { useConversationList } from "../use-conversation-list";
import type { ConversationSummary } from "../use-conversation-list";

type Props = Readonly<{
  dict: ChatDict;
  status: AuthStatus;
  baseUrl: string;
  activeSessionId: string | undefined;
}>;

/** Mockup `.side`: the cream sidebar card, desktop only. No `self-start` —
 * the aside stretches to the shell row's full height so the identity card can
 * anchor at its foot even when RECENT renders no rows. */
const SIDEBAR_CLASS = "[display:none] lg:[display:flex] w-[292px] flex-col gap-[18px] rounded-3xl border-[3px] border-ground-ink bg-card p-[22px_18px] text-ground-ink shadow-[0_6px_0_var(--shadow-3d)]";
const BRAND_CLASS = "flex items-center gap-2.5";
const BRAND_NAME_CLASS = "text-[21px] font-black leading-[1.1]";
const BRAND_TAG_CLASS = "text-[11px] font-bold opacity-70";
/** The keyboard ring on the new chrome: ground-ink flips with the theme, so
 * the same outline is the high-contrast ink on day cream and night pine. The
 * library ships its own 2px teal ring on `.animal-btn:focus-visible`; our
 * utilities layer beats its components layer, so this stays the ONE ring. */
const FOCUS_RING = "focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ground-ink";
/* The chrome's buttons are the library's 3D-press `animal-btn`, rethemed onto
 * our tokens through its `--animal-*` surface (the LoginForm idiom): the press
 * ledge rides `--shadow-3d` so the depth flips with the theme. Utilities on the
 * same element pin only the mockup's geometry (border, padding, ring) — the
 * utilities layer beats the package's components layer, so they never fight. */
const GOLD_PRESS = "[--animal-bg-color:var(--color-gold)] [--animal-text-color:var(--color-gold-ink)] [--animal-shadow-press:0_4px_0_0_var(--shadow-3d)] [--animal-shadow-press-hover:0_5px_0_0_var(--shadow-3d)] [--animal-shadow-press-active:0_1px_0_0_var(--shadow-3d)]";
const PAPER_QUIET = "[--animal-bg-color:var(--color-paper)] [--animal-text-color:var(--color-ground-ink)] [--animal-border-color:var(--color-ground-ink)]";
const NEW_CLASS = `animal-btn animal-btn-primary animal-btn-block border-[3px] border-ground-ink px-[18px] py-[11px] text-[14.5px] font-black no-underline ${FOCUS_RING} ${GOLD_PRESS}`;
const RECENT_HEADING_CLASS = "mb-3 text-[11.5px] font-black uppercase tracking-[0.16em] opacity-70";
const ROW_CLASS = `grid cursor-pointer gap-0.5 rounded-[14px] px-3 py-2.5 no-underline text-ground-ink hover:bg-gold-soft ${FOCUS_RING}`;
const ROW_ACTIVE_CLASS = "bg-primary-soft shadow-[0_0_0_2px_var(--color-primary)] hover:bg-primary-soft";
const ROW_TITLE_CLASS = "truncate text-sm font-black";
const ROW_SUB_CLASS = "truncate text-xs font-bold opacity-70";
/** `mt-auto` pins the identity card to the sidebar's foot; the RECENT nav is
 * `flex-1` when present, but anonymous renders no nav at all. */
const ME_CLASS = "mt-auto flex items-center gap-2.5 border-t-2 border-dashed border-ground-ink/25 pt-3.5";

function BrandLockup({ dict }: Readonly<{ dict: ChatDict }>) {
  const words = <div><div className={BRAND_NAME_CLASS}>{dict.appbar.brand}</div><div className={BRAND_TAG_CLASS}>{dict.brandTagline}</div></div>;
  return <div className={BRAND_CLASS}><img src="/images/landing/torii.svg" alt="" width={38} height={38} />{words}</div>;
}

/** Fresh conversation: a document navigation, the way the retired app bar's
 * new-chat link worked — the page's own cold start yields a genuinely new
 * conversation from every state. */
function NewJourneyLink({ dict }: Readonly<{ dict: ChatDict }>) {
  return (
    <a href="/chat" className={NEW_CLASS} aria-label={dict.newJourney}>
      <span aria-hidden="true">＋</span>
      {dict.newJourney}
    </a>
  );
}

function rowClass(active: boolean): string {
  return active ? `${ROW_CLASS} ${ROW_ACTIVE_CLASS}` : ROW_CLASS;
}

function ConversationRow({ conversation, active }: Readonly<{ conversation: ConversationSummary; active: boolean }>) {
  return (
    <a href={chatSessionTarget(conversation.id) ?? "/chat"} className={rowClass(active)}>
      <span className={ROW_TITLE_CLASS}>{conversation.title}</span>
      {conversation.subtitle === "" ? null : <span className={ROW_SUB_CLASS}>{conversation.subtitle}</span>}
    </a>
  );
}

function RecentList({ dict, conversations, activeSessionId }: Readonly<{ dict: ChatDict; conversations: readonly ConversationSummary[]; activeSessionId: string | undefined }>) {
  if (conversations.length === 0) return null;
  const rows = conversations.map((conversation) => (
    <ConversationRow key={conversation.id} conversation={conversation} active={conversation.id === activeSessionId} />
  ));
  const heading = <h2 className={RECENT_HEADING_CLASS}>{dict.recentLabel}</h2>;
  return <nav className="min-h-0 flex-1 overflow-y-auto" aria-label={dict.recentLabel}>{heading}<div className="grid gap-2.5">{rows}</div></nav>;
}

function GearIcon() {
  return (
    <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

/** Carries the live conversation as `?session=` so the settings page's own
 * back link returns to it instead of a fresh draft (#1337). */
function SettingsGear({ dict }: Readonly<{ dict: ChatDict }>) {
  const session = useChatSessionId();
  return (
    <Link to="/settings" search={{ session }} className={`ml-auto grid size-9 flex-none place-items-center rounded-full text-ground-ink no-underline hover:bg-gold-soft ${FOCUS_RING}`} aria-label={dict.appbar.settings}>
      <GearIcon />
    </Link>
  );
}

function SignedInCard({ dict }: Readonly<{ dict: ChatDict }>) {
  const avatar = <span className="grid size-[38px] flex-none place-items-center rounded-full border-[2.5px] border-ground-ink bg-gold text-[15px] font-black text-gold-ink" role="img" aria-label={dict.appbar.signedIn}>{dict.appbar.brand.charAt(0)}</span>;
  const who = <div className="min-w-0"><div className="truncate text-[13.5px] font-black">{dict.appbar.brand}</div><div className="truncate text-[11.5px] font-bold opacity-70">{dict.brandTagline}</div></div>;
  return <>{avatar}{who}</>;
}

/** The anonymous login affordance: the library's quiet `default` button (no
 * ledge in the mockup), rethemed to paper/ink on the wrapper's vars. */
function LoginButton({ dict, onClick }: Readonly<{ dict: ChatDict; onClick: () => void }>) {
  return (
    <span className={`min-w-0 flex-1 ${PAPER_QUIET}`}>
      <Button type="default" className={`min-h-11 w-full text-sm font-black ${FOCUS_RING}`} onClick={onClick}>{dict.appbar.login}</Button>
    </span>
  );
}

/** Anonymous never gets a stand-in avatar: the login affordance takes the
 * card's place, with the settings deep link beside it. */
function AnonymousCard({ dict }: Readonly<{ dict: ChatDict }>) {
  const [open, setOpen] = useState(false);
  const returnTarget = useChatReturnTarget();
  return (
    <>
      <LoginButton dict={dict} onClick={() => { setOpen(true); }} />
      <LoginModal open={open} onClose={() => { setOpen(false); }} returnTarget={returnTarget} />
    </>
  );
}

/** Pending renders no identity slot at all — the same rule the mobile bar's
 * LoginEntry follows — so a signed-in visitor never flashes a Log in button
 * while the session resolves. The settings gear stays: it owes no identity. */
function UserCard({ dict, status }: Readonly<{ dict: ChatDict; status: AuthStatus }>) {
  if (status === "pending") return <div className={ME_CLASS}><SettingsGear dict={dict} /></div>;
  const card = status === "authenticated" ? <SignedInCard dict={dict} /> : <AnonymousCard dict={dict} />;
  return <div className={ME_CLASS}>{card}<SettingsGear dict={dict} /></div>;
}

/** Direction-E `.side`: brand, the gold new-journey pill, the RECENT rows from
 * GET /v1/conversations, and the identity card. Empty or failed lists simply
 * render no rows. */
export function ChatSidebar({ dict, status, baseUrl, activeSessionId }: Props) {
  const list = useConversationList(baseUrl, status === "authenticated");
  const recent = <RecentList dict={dict} conversations={list.conversations} activeSessionId={activeSessionId} />;
  return (
    <aside className={SIDEBAR_CLASS}><BrandLockup dict={dict} /><NewJourneyLink dict={dict} />{recent}<UserCard dict={dict} status={status} /></aside>
  );
}
