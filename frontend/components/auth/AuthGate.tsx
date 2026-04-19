"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useDict, useLocale, useSetLocale } from "../../lib/i18n-context";
import { LOCALES, type Locale } from "../../lib/i18n";
import { getSupabaseClient } from "../../lib/supabase";
import AppShell from "../layout/AppShell";

/* ── Pin positions (labels come from i18n dictionaries) ── */
const PIN_POSITIONS: { top: string; left: string; labelKey?: string }[] = [
  { top: "30%", left: "46%", labelKey: "pin_yourname" },
  { top: "42%", left: "56%", labelKey: "pin_euphonium" },
  { top: "52%", left: "44%", labelKey: "pin_violet" },
  { top: "36%", left: "38%" },
  { top: "48%", left: "60%" },
  { top: "26%", left: "52%" },
  { top: "58%", left: "50%" },
  { top: "40%", left: "48%" },
];

const LOCALE_LABELS: Record<Locale, string> = { ja: "日本語", zh: "中文", en: "EN" };

export default function AuthGate() {
  const dict = useDict();
  const t = dict.auth;
  const lh = dict.landing_hero;
  const locale = useLocale();
  const setLocale = useSetLocale();
  const authClient = getSupabaseClient();
  const authConfigured = !!authClient;

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(authConfigured);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const effectiveStatus = status ?? (!authConfigured ? t.not_configured : null);

  /* ── Scroll-reveal ── */
  const revealRefs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("seichi-visible");
        });
      },
      { threshold: 0.15 },
    );
    revealRefs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);
  const addRevealRef = (el: HTMLElement | null) => {
    if (el && !revealRefs.current.includes(el)) revealRefs.current.push(el);
  };

  /* ── Auth logic (preserved) ── */
  useEffect(() => {
    if (!authClient) return;

    authClient.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, [authClient]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!authClient) { setStatus(t.not_configured); return; }
    setSubmitting(true);
    setStatus(null);
    const normalizedEmail = email.trim().toLowerCase();
    // Fire-and-forget: track signup for analytics
    authClient.from("waitlist").upsert({ email: normalizedEmail }, { onConflict: "email" }).then(() => {});
    const { error } = await authClient.auth.signInWithOtp({
      email: normalizedEmail,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback/` },
    });
    if (error) {
      setStatus(t.error.replace("{message}", error.message));
    } else {
      setSent(true);
    }
    setSubmitting(false);
  }

  /* ── Render hint text with safe HTML (only bold tags from static i18n) ── */
  function renderHint(html: string): React.ReactNode {
    // The hint strings contain only <strong> tags from our own dictionary files.
    // Parse them safely instead of using dangerouslySetInnerHTML.
    const parts = html.split(/(<strong>.*?<\/strong>)/g);
    return parts.map((part, i) => {
      const match = part.match(/^<strong>(.*)<\/strong>$/);
      if (match) {
        return <strong key={i} className="font-medium text-[var(--color-fg)]">{match[1]}</strong>;
      }
      return part;
    });
  }

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="text-[var(--color-muted-fg)]">{t.loading}</div>
      </div>
    );
  }

  /* ── Authenticated → AppShell ── */
  if (session) return <AppShell />;

  /* ── Landing page ── */
  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--color-bg)]" style={{ fontFamily: "var(--app-font-body)" }}>

      {/* ── Sticky Header ── */}
      <header
        className="fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b px-4 py-3 sm:px-8"
        style={{
          background: "color-mix(in oklch, var(--color-bg) 85%, transparent)",
          backdropFilter: "blur(16px)",
          borderColor: "color-mix(in oklch, var(--color-border) 30%, transparent)",
          animation: "seichi-fade-up 0.6s ease-out",
        }}
      >
        <div style={{ fontFamily: "var(--app-font-display)", fontSize: 18, lineHeight: 1.2 }}>
          聖地巡礼
          <span className="block text-[10px] font-light tracking-[2.5px] text-[var(--color-muted-fg)]" style={{ fontFamily: "var(--app-font-body)" }}>
            seichijunrei
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Language switcher */}
          <div className="flex gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-0.5">
            {LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                className="min-h-[44px] min-w-[44px] rounded px-2.5 py-1 text-xs font-medium transition-all"
                style={{
                  transitionDuration: "var(--duration-fast)",
                  background: locale === l ? "var(--color-bg)" : "transparent",
                  color: locale === l ? "var(--color-fg)" : "var(--color-muted-fg)",
                  boxShadow: locale === l ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  fontFamily: "var(--app-font-body)",
                }}
              >
                {LOCALE_LABELS[l]}
              </button>
            ))}
          </div>
          {/* Login link (hidden on mobile) */}
          <button
            type="button"
            onClick={() => setShowAuthModal(true)}
            className="min-h-[44px] px-3 text-[13px] text-[var(--color-muted-fg)]"
          >
            {lh.login}
          </button>
          {/* Join beta CTA */}
          <button
            type="button"
            onClick={() => setShowAuthModal(true)}
            className="min-h-[44px] rounded-md bg-[var(--color-primary)] px-4 py-1.5 text-[13px] font-semibold text-[var(--color-primary-fg)]"
          >
            {lh.join_beta}
          </button>
        </div>
      </header>

      {/* ── Section 1: MAP HERO ── */}
      <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden pt-[60px]">
        {/* Radial gradient bg */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse 800px 800px at 50% 50%, oklch(94% 0.016 220), var(--color-bg))" }}
        />
        {/* Abstract Japan shape */}
        <div
          className="pointer-events-none absolute opacity-50"
          style={{
            width: 200, height: 480, top: "48%", left: "50%",
            transform: "translate(-50%, -50%) rotate(-15deg)",
            background: "oklch(91% 0.022 218)",
            borderRadius: "35% 65% 45% 55% / 55% 45% 55% 45%",
          }}
        />

        {/* Pins */}
        {PIN_POSITIONS.map((pin, i) => {
          const pinLabel = pin.labelKey
            ? (lh as Record<string, string>)[pin.labelKey] ?? ""
            : "";
          return (
            <div key={i} className="group absolute z-[3]" style={{ top: pin.top, left: pin.left }}>
              <div
                className="h-2.5 w-2.5 cursor-pointer rounded-full bg-[var(--color-primary)]"
                style={{ animation: `seichi-pin-pulse 2.5s ease-in-out infinite ${i % 2 === 0 ? "0s" : "0.8s"}` }}
              />
              {pinLabel && (
                <div
                  className="pointer-events-none absolute bottom-[18px] left-1/2 hidden -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-lg bg-[var(--color-bg)] p-1 opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100 sm:block"
                  style={{ transitionDuration: "250ms" }}
                >
                  <div
                    className="h-[60px] w-[88px] rounded-md"
                    style={{ background: "var(--color-card)" }}
                  />
                  <div className="px-1 pb-0.5 pt-1 text-center text-[9px] font-medium text-[var(--color-muted-fg)]">
                    {pinLabel}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Hero center content */}
        <div className="relative z-[5] max-w-[540px] px-6 text-center">
          <h1
            className="font-[family-name:var(--app-font-display)] text-[clamp(52px,9vw,80px)] font-extrabold tracking-[0.04em] text-[var(--color-fg)]"
            style={{ animation: "seichi-fade-up 0.8s ease-out" }}
          >
            聖地巡礼
          </h1>
          <p
            className="mt-2.5 text-[17px] font-light leading-relaxed text-[var(--color-muted-fg)]"
            style={{ animation: "seichi-fade-up 0.8s ease-out 0.1s backwards" }}
          >
            {lh.tagline}
          </p>

          {/* Chat input */}
          <div
            className="mt-7 flex overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg)] shadow-[0_4px_20px_rgba(0,0,0,0.05)] transition-shadow focus-within:border-[var(--color-primary)] focus-within:shadow-[0_4px_24px_rgba(74,130,220,0.15)]"
            style={{ animation: "seichi-fade-up 0.8s ease-out 0.2s backwards", transitionDuration: "300ms" }}
          >
            <input
              type="text"
              placeholder={lh.chat_placeholder}
              onFocus={() => setShowAuthModal(true)}
              className="min-h-[52px] flex-1 border-none bg-transparent px-5 text-[15px] text-[var(--color-fg)] outline-none placeholder:text-[var(--color-border)]"
              style={{ fontFamily: "var(--app-font-body)" }}
              readOnly
            />
            <button
              type="button"
              onClick={() => setShowAuthModal(true)}
              className="min-h-[52px] min-w-[44px] bg-[var(--color-primary)] px-6 text-sm font-semibold text-[var(--color-primary-fg)] transition-opacity hover:opacity-90"
              style={{ fontFamily: "var(--app-font-body)" }}
            >
              {lh.chat_submit}
            </button>
          </div>

          {/* Search hint */}
          <p
            className="mt-3 text-xs text-[var(--color-muted-fg)]"
            style={{ animation: "seichi-fade-up 0.8s ease-out 0.4s backwards" }}
          >
            {renderHint(lh.hint)}
          </p>
        </div>

        {/* Stats row */}
        <div
          className="relative z-[5] mt-12 flex gap-6 sm:gap-11"
          style={{ animation: "seichi-fade-up 0.8s ease-out 0.35s backwards" }}
        >
          {([
            ["2,400+", lh.stat_locations],
            ["180+", lh.stat_anime],
            ["47", lh.stat_prefectures],
          ] as const).map(([num, label]) => (
            <div key={num} className="text-center">
              <div className="font-[family-name:var(--app-font-display)] text-[28px] font-bold text-[var(--color-primary)]">
                {num}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--color-muted-fg)]">{label}</div>
            </div>
          ))}
        </div>

        {/* Scroll cue */}
        <div
          className="absolute bottom-7 z-[5] flex flex-col items-center gap-1 text-[11px] text-[var(--color-muted-fg)]"
          style={{ animation: "seichi-fade-up 1s ease-out 0.8s backwards" }}
        >
          <span>{lh.scroll_hint}</span>
          <span className="text-base" style={{ animation: "float-arrow 2.5s ease-in-out infinite" }}>↓</span>
        </div>
      </section>

      {/* ── Section 2: Comparison ── */}
      <section className="mx-auto max-w-[920px] px-5 py-12 sm:px-8 sm:py-20">
        <h2
          ref={addRevealRef}
          className="seichi-reveal font-[family-name:var(--app-font-display)] text-center text-[28px]"
        >
          {lh.comparison_title}
        </h2>
        <p
          ref={addRevealRef}
          className="seichi-reveal mb-10 mt-1.5 text-center text-sm text-[var(--color-muted-fg)]"
        >
          {lh.comparison_sub}
        </p>
        <div className="grid grid-cols-1 gap-2.5 overflow-hidden rounded-[10px] sm:grid-cols-2">
          <div
            ref={addRevealRef}
            className="seichi-reveal-left relative aspect-[16/10] overflow-hidden rounded-md bg-[var(--color-card)]"
          >
            <div className="flex h-full w-full items-center justify-center text-sm text-[var(--color-muted-fg)]">
              ANIME
            </div>
            <div className="absolute bottom-2.5 left-2.5 rounded bg-black/50 px-3 py-0.5 text-[9px] font-semibold uppercase tracking-[2px] text-white backdrop-blur-sm">
              ANIME
            </div>
          </div>
          <div
            ref={addRevealRef}
            className="seichi-reveal-right relative aspect-[16/10] overflow-hidden rounded-md bg-[var(--color-card)]"
          >
            <div className="flex h-full w-full items-center justify-center text-sm text-[var(--color-muted-fg)]">
              REALITY
            </div>
            <div className="absolute bottom-2.5 left-2.5 rounded bg-black/50 px-3 py-0.5 text-[9px] font-semibold uppercase tracking-[2px] text-white backdrop-blur-sm">
              REALITY
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: Features ── */}
      <section className="mx-auto grid max-w-[800px] grid-cols-1 gap-4 px-5 py-10 sm:grid-cols-3 sm:px-8 sm:py-[60px]">
        {([
          [lh.feat_search, lh.feat_search_desc],
          [lh.feat_route, lh.feat_route_desc],
          [lh.feat_series, lh.feat_series_desc],
        ] as const).map(([title, desc], i) => (
          <div
            key={i}
            ref={addRevealRef}
            className="seichi-reveal-pop rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-[22px_18px] transition-transform hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.04)]"
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            <h3 className="font-[family-name:var(--app-font-display)] text-[15px]">{title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted-fg)]">{desc}</p>
          </div>
        ))}
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--color-border)] py-7 text-center text-[11px] text-[var(--color-muted-fg)]">
        <span style={{ fontFamily: "var(--app-font-display)" }}>聖地巡礼</span> · seichijunrei
      </footer>

      {/* ── Auth Modal (overlay) ── */}
      {showAuthModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAuthModal(false); }}
        >
          <div
            className="relative mx-4 w-full max-w-[420px] rounded-xl bg-[var(--color-bg)] p-8 shadow-2xl"
            style={{ animation: "seichi-fade-up 0.3s ease-out" }}
          >
            {/* Close */}
            <button
              type="button"
              onClick={() => setShowAuthModal(false)}
              className="absolute right-4 top-4 min-h-[44px] min-w-[44px] text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
              aria-label="Close"
            >
              ✕
            </button>

            <div className="mb-8">
              <h2 className="text-base font-medium text-[var(--color-fg)]">
                {t.tab_login}
              </h2>
              <p className="mt-1 text-xs font-light text-[var(--color-muted-fg)]">
                {t.subtitle}
              </p>
            </div>

            {/* Form or success card */}
            {sent ? (
              <div className="space-y-4">
                <p className="text-sm font-medium text-[var(--color-fg)]">{t.check_email_heading}</p>
                <p className="text-xs leading-relaxed text-[var(--color-muted-fg)]">{t.check_email_body}</p>
                <button
                  type="button"
                  onClick={() => { setSent(false); setStatus(null); }}
                  className="min-h-[44px] text-xs underline text-[var(--color-muted-fg)]"
                >
                  {t.back_to_login}
                </button>
              </div>
            ) : (
              <>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="auth-email" className="text-xs font-medium text-[var(--color-muted-fg)]">
                      {t.email_label}
                    </label>
                    <input
                      id="auth-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t.email_placeholder}
                      className="w-full border-b border-[var(--color-border)] bg-transparent py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-border)] focus:border-[var(--color-primary)] focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !authConfigured}
                    className="min-h-[44px] w-full rounded-lg bg-[var(--color-primary)] py-2.5 text-xs font-medium uppercase tracking-wider text-[var(--color-primary-fg)] transition hover:opacity-90 disabled:opacity-40"
                    style={{ transitionDuration: "var(--duration-fast)" }}
                  >
                    {submitting ? t.submitting : t.btn_login}
                  </button>
                </form>

                {effectiveStatus && (
                  <p className="mt-5 text-xs font-light leading-relaxed text-[var(--color-muted-fg)]">
                    {effectiveStatus}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Reveal animation styles ── */}
      <style>{`
        .seichi-reveal, .seichi-reveal-left, .seichi-reveal-right, .seichi-reveal-pop { opacity: 0; }
        .seichi-reveal.seichi-visible { animation: seichi-fade-up 0.65s ease-out forwards; }
        .seichi-reveal-left.seichi-visible { animation: slide-in-left 0.65s ease-out forwards; }
        .seichi-reveal-right.seichi-visible { animation: slide-in-right 0.65s ease-out forwards; }
        .seichi-reveal-pop.seichi-visible { animation: pop-in 0.5s ease-out forwards; }
        @media (prefers-reduced-motion: reduce) {
          .seichi-reveal, .seichi-reveal-left, .seichi-reveal-right, .seichi-reveal-pop { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
