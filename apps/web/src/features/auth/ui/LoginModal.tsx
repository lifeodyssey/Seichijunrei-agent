import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Dict } from "../../../i18n/dictionaries";
import { useDict } from "../../../i18n/LocaleProvider";
import { LoginForm } from "./LoginForm";
import type { SendCommitted } from "./use-magic-link-form";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onSendCommitted?: SendCommitted;
  returnTarget?: string;
}

function useEscapeToClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

/** Wrap Tab once within the dialog: advancing past the last field or
 * Shift+Tab before the first loops focus back to the opposite end. */
function wrapFocus(event: KeyboardEvent, root: HTMLElement): void {
  const list = focusables(root);
  const first = list[0];
  const last = list[list.length - 1];
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  if (root.contains(active) && active !== root && active !== (event.shiftKey ? first : last)) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}

/** Initial focus lands on the first text entry field (the email input), the
 * natural default action for a login dialog; cleanup restores the trigger. */
function focusTrapEffect(open: boolean, rootRef: RefObject<HTMLDivElement | null>): () => void {
  const root = open ? rootRef.current : null;
  if (!root) return () => undefined;
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const onKey = (event: KeyboardEvent): void => { if (event.key !== "Tab") return; wrapFocus(event, root); };
  document.addEventListener("keydown", onKey);
  const target = root.querySelector<HTMLElement>('input[type="email"], input[type="text"], textarea') ?? root;
  target.focus();
  return () => { document.removeEventListener("keydown", onKey); trigger?.focus(); };
}

/** Keyboard nav mirror for the login modal (same WAI-ARIA modal pattern as the
 * showcase ComingSoonPopup): the email input gets initial focus, Tab wraps
 * within the dialog, and closing restores focus to the trigger. */
function useFocusTrap(open: boolean, rootRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => focusTrapEffect(open, rootRef), [open, rootRef]);
}

interface LoginDialogProps {
  auth: Dict["auth"];
  onClose: () => void;
  onSendCommitted?: SendCommitted;
  returnTarget?: string;
  panelRef: RefObject<HTMLDivElement | null>;
}

/** The dialog's welcome header: title and subtitle only — the mascot set is
 * shelved this round (owner 2026-08-30). */
function LoginWelcome({ auth }: { auth: Dict["auth"] }) {
  return (
    <>
      <h2 className="login-modal__title">{auth.title}</h2>
      <p className="login-modal__subtitle">{auth.subtitle}</p>
    </>
  );
}

function LoginDialog({ auth, onClose, onSendCommitted, returnTarget, panelRef }: LoginDialogProps) {
  return (
    <div className="login-modal" role="dialog" aria-modal="true" aria-label={auth.title} tabIndex={-1} ref={panelRef} onClick={(event) => { event.stopPropagation(); }}>
      <button className="login-modal__close" type="button" aria-label={auth.close} onClick={onClose}>×</button>
      <LoginWelcome auth={auth} />
      <LoginForm onSendCommitted={onSendCommitted} returnTarget={returnTarget} />
    </div>
  );
}

/** Magic-link login dialog wired to the Neon Auth (Better Auth) client.
 * Deliberately NOT the library `Modal`: it renders no close button (our pinned
 * 閉じる affordance is the first tab stop), its Radix FocusScope autofocuses
 * the FIRST tabbable with no `onOpenAutoFocus` escape hatch (our pinned initial
 * focus is the email field, which must stay second in tab order), and its panel
 * is blob-clipped by a package-internal SVG path. The shell stays ours; the
 * form fields inside already ride the library's input/button classes. */
export function LoginModal({ open, onClose, onSendCommitted, returnTarget }: LoginModalProps) {
  const auth = useDict().auth;
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeToClose(open, onClose);
  useFocusTrap(open, panelRef);
  if (!open) return null;
  return <div className="login-modal__mask" role="presentation" onClick={onClose}>
    <LoginDialog auth={auth} onClose={onClose} onSendCommitted={onSendCommitted} returnTarget={returnTarget} panelRef={panelRef} />
  </div>;
}
