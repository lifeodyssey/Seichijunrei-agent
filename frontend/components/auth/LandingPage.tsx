"use client";

import { useState } from "react";
import { useDict, useLocale } from "../../lib/i18n-context";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import {
  FLOAT_CARDS,
  ANIME_GALLERY,
  FLOAT_CARD_STYLES,
  FLOAT_DELAYS,
  handleImageError,
} from "./LandingData";

interface LandingPageProps { onOpenAuth: () => void }

export default function LandingPage({ onOpenAuth }: LandingPageProps) {
  const dict = useDict();
  const landing = dict.landing_hero.landing;
  const locale = useLocale();
  const addRevealRef = useScrollReveal();
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearchSubmit = (e: React.FormEvent) => { e.preventDefault(); onOpenAuth(); };

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
            onClick={onOpenAuth}
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
              <img
                src={card.src}
                alt={card.label}
                width={160}
                height={108}
                loading="lazy"
                className="h-full w-full object-cover"
                onError={handleImageError}
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
          {([["2,400+", landing.stats_spots], ["180+", landing.stats_anime], ["47", landing.stats_prefectures]] as const).map(([num, label]) => (
            <div key={num} className="text-center">
              <div className="font-[family-name:var(--app-font-display)] text-[32px] font-semibold text-[var(--color-primary)]">
                {num}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--color-muted-fg)]">{label}</div>
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
              { num: "1", title: landing.step1_title, desc: landing.step1_desc },
              { num: "2", title: landing.step2_title, desc: landing.step2_desc },
              { num: "3", title: landing.step3_title, desc: landing.step3_desc },
            ] as const
          ).map((step, i) => (
            <div
              key={step.num}
              ref={addRevealRef}
              className="seichi-reveal-pop rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-[28px_24px] transition-transform hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <div className="mb-3.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-primary)] text-[13px] font-semibold text-[var(--color-primary-fg)]">
                {step.num}
              </div>
              <h3 className="font-[family-name:var(--app-font-display)] text-[16px]">
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
              style={{ aspectRatio: "3/2", animationDelay: `${i * 0.05}s` }}
              onClick={onOpenAuth}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onOpenAuth();
              }}
            >
              <img
                src={`https://image.anitabi.cn/bangumi/${anime.bangumiId}.jpg?plan=h160`}
                alt={anime.title}
                width={240}
                height={160}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                onError={handleImageError}
              />
              <div
                className="absolute inset-0 flex flex-col justify-end p-3"
                style={{ background: "linear-gradient(transparent 40%, rgba(0,0,0,0.65))" }}
              >
                <div className="font-[family-name:var(--app-font-display)] text-[13px] font-semibold text-white">
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
    </div>
  );
}
