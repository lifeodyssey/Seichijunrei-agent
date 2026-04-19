"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useDict, useLocale } from "../../lib/i18n-context";
import { getSupabaseClient } from "../../lib/supabase";
import AppShell from "../layout/AppShell";

/* ── Anitabi floating photo cards ── */
const FLOAT_CARDS: {
  src: string;
  label: string;
  ep: string;
  cls: string;
  rotate: string;
}[] = [
  {
    src: "https://image.anitabi.cn/points/115908/qys7fu.jpg?plan=h160",
    label: "京都コンサートホール",
    ep: "EP1",
    cls: "fc-1",
    rotate: "-3deg",
  },
  {
    src: "https://image.anitabi.cn/points/160209/al3yeri_1770054618536.jpg?plan=h160",
    label: "マンション桂",
    ep: "君の名は。",
    cls: "fc-2",
    rotate: "2deg",
  },
  {
    src: "https://image.anitabi.cn/points/115908/7evkbmy2.jpg?plan=h160",
    label: "あじろぎの道",
    ep: "EP1",
    cls: "fc-3",
    rotate: "-1deg",
  },
  {
    src: "https://image.anitabi.cn/points/160209/3ik9kj0e.jpg?plan=h160",
    label: "信濃町歩道橋",
    ep: "君の名は。",
    cls: "fc-4",
    rotate: "3deg",
  },
  {
    src: "https://image.anitabi.cn/points/115908/7eyih3xg.jpg?plan=h160",
    label: "莵道高",
    ep: "EP1",
    cls: "fc-5",
    rotate: "-2deg",
  },
  {
    src: "https://image.anitabi.cn/points/160209/3ik9kjew.jpg?plan=h160",
    label: "LABI新宿東口館前",
    ep: "君の名は。",
    cls: "fc-6",
    rotate: "1deg",
  },
];

/* ── Anime gallery ── */
const ANIME_GALLERY: {
  bangumiId: string;
  title: string;
  count: string;
}[] = [
  { bangumiId: "115908", title: "響け！ユーフォニアム", count: "156 スポット · 宇治市" },
  { bangumiId: "160209", title: "君の名は。", count: "89 スポット · 新宿/飛騨" },
  { bangumiId: "269235", title: "天気の子", count: "72 スポット · 東京" },
  { bangumiId: "485", title: "涼宮ハルヒの憂鬱", count: "134 スポット · 西宮市" },
  { bangumiId: "1424", title: "けいおん！", count: "98 スポット · 京都/豊郷" },
  { bangumiId: "362577", title: "すずめの戸締まり", count: "65 スポット · 九州〜東北" },
  { bangumiId: "55113", title: "たまこまーけっと", count: "47 スポット · 出町柳" },
  { bangumiId: "27364", title: "氷菓", count: "82 スポット · 高山市" },
];

/* ── Float card position styles ── */
const FLOAT_CARD_STYLES: Record<string, React.CSSProperties> = {
  "fc-1": { top: "18%", left: "8%", width: 140, height: 95 },
  "fc-2": { top: "28%", right: "12%", width: 160, height: 108 },
  "fc-3": { bottom: "30%", left: "6%", width: 130, height: 88 },
  "fc-4": { bottom: "22%", right: "8%", width: 150, height: 100 },
  "fc-5": { top: "50%", left: "18%", width: 120, height: 80 },
  "fc-6": { top: "14%", left: "35%", width: 110, height: 75 },
};

const FLOAT_DELAYS: Record<string, string> = {
  "fc-1": "0.2s",
  "fc-2": "0.4s",
  "fc-3": "0.6s",
  "fc-4": "0.8s",
  "fc-5": "1.0s",
  "fc-6": "0.3s",
};

export default function AuthGate() {
  const dict = useDict();
  const t = dict.auth;
  const lh = dict.landing_hero;
  const landing = lh.landing;
  const locale = useLocale();
  const authClient = getSupabaseClient();
  const authConfigured = !!authClient;

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(authConfigured);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
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

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    // On landing, search opens auth modal to transition to the app
    setShowAuthModal(true);
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
    <div
      className="min-h-screen overflow-x-hidden bg-[var(--color-bg)]"
      style={{ fontFamily: "var(--app-font-body)" }}
      lang={locale}
    >

      {/* ── Sticky Header ── */}
      <header
        className="fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b px-4 py-3 sm:px-8"
        style={{
          background: "color-mix(in oklch, var(--color-bg) 85%, transparent)",
          backdropFilter: "blur(16px)",
          borderColor: "color-mix(in oklch, var(--color-border) 30%, transparent)",
          animation: "seichi-fade-down 0.5s ease-out",
        }}
      >
        <div
          style={{
            fontFamily: "var(--app-font-display)",
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "0.03em",
            lineHeight: 1.2,
          }}
        >
          聖地巡礼
          <span
            className="block text-[10px] font-light tracking-[2.5px] text-[var(--color-muted-fg)]"
            style={{ fontFamily: "var(--app-font-body)" }}
          >
            seichijunrei
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAuthModal(true)}
            className="min-h-[44px] rounded-md px-4 py-1.5 text-[13px] text-[var(--color-muted-fg)] transition-colors hover:bg-[var(--color-muted)]"
            style={{ fontFamily: "var(--app-font-body)" }}
          >
            {landing.login}
          </button>
        </div>
      </header>

      {/* ── Section 1: HERO ── */}
      <section
        data-testid="hero-section"
        className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden pt-[60px]"
      >
        {/* Radial gradient background */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 900px 900px at 50% 45%, oklch(93% 0.020 220), var(--color-bg))",
          }}
        />

        {/* ── Floating photo cards ── */}
        <div
          data-testid="floating-cards"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          {FLOAT_CARDS.map((card) => (
            <div
              key={card.cls}
              className="absolute overflow-hidden rounded-xl"
              style={{
                ...FLOAT_CARD_STYLES[card.cls],
                boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
                opacity: 0,
                transform: `rotate(${card.rotate})`,
                animation: `seichi-float-in 0.8s ease-out ${FLOAT_DELAYS[card.cls]} forwards`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={card.src}
                alt={card.label}
                width={160}
                height={108}
                loading="lazy"
                className="h-full w-full object-cover"
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = "none";
                  const parent = target.parentElement;
                  if (parent) {
                    parent.style.background =
                      "linear-gradient(135deg, oklch(88% 0.04 240), oklch(82% 0.06 260))";
                  }
                }}
              />
              <div
                className="absolute inset-x-0 bottom-0 px-2.5 py-1.5 text-[10px] font-medium text-white"
                style={{
                  background: "linear-gradient(transparent, rgba(0,0,0,0.6))",
                  letterSpacing: "0.3px",
                }}
              >
                {card.label}
                <span className="ml-1 opacity-70" style={{ fontSize: 9 }}>
                  {card.ep}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Hero center content ── */}
        <div className="relative z-[5] max-w-[560px] px-6 text-center">
          <h1
            className="font-[family-name:var(--app-font-display)] text-[clamp(56px,10vw,88px)] font-extrabold tracking-[0.04em] leading-[1.1] text-[var(--color-fg)]"
            style={{ animation: "seichi-fade-up 0.8s ease-out" }}
          >
            {landing.hero_title}
          </h1>
          <p
            className="mt-3 text-[18px] font-light leading-relaxed text-[var(--color-muted-fg)]"
            style={{ animation: "seichi-fade-up 0.8s ease-out 0.1s backwards" }}
          >
            {landing.hero_subtitle}
          </p>

          {/* Search bar */}
          <form
            onSubmit={handleSearchSubmit}
            className="mt-8 flex overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg)] shadow-[0_4px_24px_rgba(0,0,0,0.05)] transition-shadow focus-within:border-[var(--color-primary)] focus-within:shadow-[0_4px_28px_rgba(74,130,220,0.15)]"
            style={{
              animation: "seichi-fade-up 0.8s ease-out 0.2s backwards",
              transitionDuration: "300ms",
            }}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={landing.search_placeholder}
              className="min-h-[52px] flex-1 border-none bg-transparent px-5 text-[15px] text-[var(--color-fg)] outline-none placeholder:text-[var(--color-border)]"
              style={{ fontFamily: "var(--app-font-body)" }}
            />
            <button
              type="submit"
              className="min-h-[52px] min-w-[44px] bg-[var(--color-primary)] px-6 text-[14px] font-semibold text-[var(--color-primary-fg)] transition-opacity hover:opacity-90"
              style={{ fontFamily: "var(--app-font-body)" }}
            >
              {landing.search_button}
            </button>
          </form>
        </div>

        {/* ── Stats ── */}
        <div
          className="relative z-[5] mt-12 flex gap-12 sm:gap-12"
          style={{ animation: "seichi-fade-up 0.8s ease-out 0.4s backwards" }}
        >
          {(
            [
              ["2,400+", landing.stats_spots],
              ["180+", landing.stats_anime],
              ["47", landing.stats_prefectures],
            ] as const
          ).map(([num, label]) => (
            <div key={num} className="text-center">
              <div
                className="font-[family-name:var(--app-font-display)] text-[32px] font-semibold text-[var(--color-primary)]"
              >
                {num}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--color-muted-fg)]">
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* ── Scroll cue ── */}
        <div
          className="absolute bottom-7 z-[5] flex flex-col items-center gap-1 text-[11px] text-[var(--color-muted-fg)]"
          style={{ animation: "seichi-fade-up 1s ease-out 0.8s backwards" }}
        >
          <span>{landing.scroll_hint}</span>
          <span
            className="text-base"
            style={{ animation: "seichi-bounce 2.5s ease-in-out infinite" }}
          >
            ↓
          </span>
        </div>
      </section>

      {/* ── Section 2: 3-step How It Works ── */}
      <section
        data-testid="steps-section"
        className="mx-auto max-w-[960px] px-5 py-[80px] sm:px-8"
      >
        <h2
          ref={addRevealRef}
          className="seichi-reveal font-[family-name:var(--app-font-display)] text-center text-[28px]"
        >
          {landing.steps_title}
        </h2>
        <p
          ref={addRevealRef}
          className="seichi-reveal mb-12 mt-2 text-center text-sm text-[var(--color-muted-fg)]"
        >
          {landing.steps_sub}
        </p>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {(
            [
              {
                num: "1",
                title: landing.step1_title,
                desc: landing.step1_desc,
              },
              {
                num: "2",
                title: landing.step2_title,
                desc: landing.step2_desc,
              },
              {
                num: "3",
                title: landing.step3_title,
                desc: landing.step3_desc,
              },
            ] as const
          ).map((step, i) => (
            <div
              key={step.num}
              ref={addRevealRef}
              className="seichi-reveal-pop rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-[28px_24px] transition-transform hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <div
                className="mb-3.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-primary)] text-[13px] font-semibold text-white"
              >
                {step.num}
              </div>
              <h3
                className="font-[family-name:var(--app-font-display)] text-[16px]"
              >
                {step.title}
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted-fg)]">
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 3: Anime Gallery ── */}
      <section
        data-testid="gallery-section"
        className="mx-auto max-w-[960px] px-5 pb-[80px] sm:px-8"
      >
        <h2
          ref={addRevealRef}
          className="seichi-reveal font-[family-name:var(--app-font-display)] text-center text-[28px]"
        >
          {landing.gallery_title}
        </h2>
        <p
          ref={addRevealRef}
          className="seichi-reveal mb-12 mt-2 text-center text-sm text-[var(--color-muted-fg)]"
        >
          {landing.gallery_sub}
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ANIME_GALLERY.map((anime, i) => (
            <div
              key={anime.bangumiId}
              ref={addRevealRef}
              className="seichi-reveal-pop anime-card group relative cursor-pointer overflow-hidden rounded-[10px]"
              style={{
                aspectRatio: "3/2",
                animationDelay: `${i * 0.05}s`,
              }}
              onClick={() => setShowAuthModal(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setShowAuthModal(true);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://image.anitabi.cn/bangumi/${anime.bangumiId}.jpg?plan=h160`}
                alt={anime.title}
                width={240}
                height={160}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = "none";
                  const parent = target.parentElement;
                  if (parent) {
                    parent.style.background =
                      "linear-gradient(135deg, oklch(88% 0.04 240), oklch(82% 0.06 260))";
                  }
                }}
              />
              <div
                className="absolute inset-0 flex flex-col justify-end p-3"
                style={{
                  background:
                    "linear-gradient(transparent 40%, rgba(0,0,0,0.65))",
                }}
              >
                <div
                  className="font-[family-name:var(--app-font-display)] text-[13px] font-semibold text-white"
                >
                  {anime.title}
                </div>
                <div className="mt-0.5 text-[10px] text-white/70">
                  {anime.count}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--color-border)] py-7 text-center text-[11px] text-[var(--color-muted-fg)]">
        <span style={{ fontFamily: "var(--app-font-display)" }}>聖地巡礼</span>{" "}
        · seichijunrei
      </footer>

      {/* ── Auth Modal (overlay) ── */}
      {showAuthModal && (
        <div
          data-testid="auth-modal"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAuthModal(false);
          }}
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
                <p className="text-sm font-medium text-[var(--color-fg)]">
                  {t.check_email_heading}
                </p>
                <p className="text-xs leading-relaxed text-[var(--color-muted-fg)]">
                  {t.check_email_body}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSent(false);
                    setStatus(null);
                  }}
                  className="min-h-[44px] text-xs underline text-[var(--color-muted-fg)]"
                >
                  {t.back_to_login}
                </button>
              </div>
            ) : (
              <>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="auth-email"
                      className="text-xs font-medium text-[var(--color-muted-fg)]"
                    >
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

      {/* ── Animation styles ── */}
      <style>{`
        @keyframes seichi-fade-up {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes seichi-fade-down {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes seichi-float-in {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to   { opacity: 0.85; transform: translateY(0) scale(1); }
        }
        @keyframes seichi-bounce {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(6px); }
        }

        .seichi-reveal,
        .seichi-reveal-pop { opacity: 0; }
        .seichi-reveal.seichi-visible {
          animation: seichi-fade-up 0.65s ease-out forwards;
        }
        .seichi-reveal-pop.seichi-visible {
          animation: seichi-pop-in 0.5s ease-out forwards;
        }
        @keyframes seichi-pop-in {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .seichi-reveal,
          .seichi-reveal-pop { opacity: 1; }
        }

        @media (max-width: 768px) {
          [data-testid="floating-cards"] > div:nth-child(n+3) { display: none; }
        }
      `}</style>
    </div>
  );
}
