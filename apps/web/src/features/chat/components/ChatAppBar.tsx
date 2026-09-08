import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { LoginModal } from "../../auth/ui/LoginModal";
import { useChatReturnTarget, useChatSessionId } from "../ChatReturnTarget";
import type { AuthStatus } from "../../../lib/auth/session";
import type { ChatDict } from "../i18n";

type Props = Readonly<{ dict: ChatDict; status: AuthStatus }>;

/** Mockup `.m-top`: the green field's own bar — it is the only chrome mobile
 * gets, so auth entry and settings stay reachable from every phone.
 * `[display:*]` arbitrary properties instead of the plain `flex` utility: the
 * animal-island package ships an unlayered `.flex` that would beat our layered
 * `lg:[display:none]` variant and pin the bar open on desktop. */
const BAR_CLASS = "items-center justify-between px-4 py-3 [display:flex] lg:[display:none]";
const LOCKUP_CLASS = "flex items-center gap-2 text-[17px] font-black text-paper [text-shadow:0_2px_0_var(--color-ground-ink),2px_0_0_var(--color-ground-ink),-2px_0_0_var(--color-ground-ink),0_-2px_0_var(--color-ground-ink)]";
/** The keyboard ring on the new chrome: ground-ink flips with the theme, so
 * the same outline is the high-contrast ink on day cream and night pine. Our
 * utilities layer beats the package's 2px teal `.animal-btn:focus-visible`
 * (components layer), so this stays the ONE ring per control. */
const FOCUS_RING = "focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ground-ink";
/* The bar's buttons are the library's `animal-btn`, rethemed through its
 * `--animal-*` surface (the LoginForm idiom): the ledged circle pair rides the
 * 3D-press `primary` grammar with the ledge remapped to `--shadow-3d` so it
 * flips with the theme; the quiet login pill is the `default` grammar. */
const PAPER_PRESS = "[--animal-bg-color:var(--color-paper)] [--animal-text-color:var(--color-ground-ink)] [--animal-shadow-press:0_3px_0_0_var(--shadow-3d)] [--animal-shadow-press-hover:0_4px_0_0_var(--shadow-3d)] [--animal-shadow-press-active:0_1px_0_0_var(--shadow-3d)]";
const PAPER_QUIET = "[--animal-bg-color:var(--color-paper)] [--animal-text-color:var(--color-ground-ink)] [--animal-border-color:var(--color-ground-ink)]";
const PLUS_CLASS = `animal-btn animal-btn-primary size-[38px] flex-none [--animal-border-width:3px] border-ground-ink text-lg font-black no-underline ${FOCUS_RING} ${PAPER_PRESS}`;
const LOGIN_CLASS = `animal-btn animal-btn-default min-h-[38px] [--animal-border-width:3px] px-3 text-sm font-black ${FOCUS_RING} ${PAPER_QUIET}`;
const GEAR_CLASS = `animal-btn animal-btn-primary size-[38px] flex-none [--animal-border-width:3px] border-ground-ink no-underline ${FOCUS_RING} ${PAPER_PRESS}`;

function MobileLockup({ dict }: Readonly<{ dict: ChatDict }>) {
  return (
    <span className={LOCKUP_CLASS}>
      <img src="/images/landing/torii.svg" alt="" width={26} height={26} />
      {dict.appbar.brand}
    </span>
  );
}

/** Same document navigation as the sidebar's gold pill: `/chat` resets every
 * draft state, which a client-side navigation to the same route cannot. */
function NewJourneyButton({ dict }: Readonly<{ dict: ChatDict }>) {
  return (
    <a href="/chat" className={PLUS_CLASS} aria-label={dict.newJourney}>
      <span aria-hidden="true">＋</span>
    </a>
  );
}

/** The identity slot: anonymous gets the login entry, pending renders nothing,
 * and a signed-in visitor gets no stand-in control at all — the desktop
 * sidebar's identity card owns the signed-in state. */
function LoginEntry({ dict, status }: Readonly<{ dict: ChatDict; status: AuthStatus }>) {
  const [open, setOpen] = useState(false);
  const returnTarget = useChatReturnTarget();
  if (status !== "anonymous") return null;
  const show = () => { setOpen(true); };
  const hide = () => { setOpen(false); };
  return (
    <><button type="button" className={LOGIN_CLASS} onClick={show}>{dict.appbar.login}</button><LoginModal open={open} onClose={hide} returnTarget={returnTarget} /></>
  );
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
    <Link to="/settings" search={{ session }} className={GEAR_CLASS} aria-label={dict.appbar.settings}>
      <GearIcon />
    </Link>
  );
}

/** The slim mobile top bar (mockup `.m-top`): outlined wordmark, new journey,
 * login, settings. Desktop renders the sidebar instead and hides this. */
export function ChatAppBar({ dict, status }: Props) {
  const actions = <div className="flex items-center gap-2"><NewJourneyButton dict={dict} /><LoginEntry dict={dict} status={status} /><SettingsGear dict={dict} /></div>;
  return <header className={BAR_CLASS}><MobileLockup dict={dict} />{actions}</header>;
}
