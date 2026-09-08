import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import { useDict } from "../../i18n/LocaleProvider";
import type { Dict } from "../../i18n/dictionaries";
import { LoginModal } from "../auth/ui/LoginModal";

/**
 * Direction contract (2026-08-30 from-zero round, owner-pinned keepers:
 * two columns, search box, image comparison, login, the animal-island class
 * layer; everything else free; no mascot this round).
 * THESIS: a postcard on the lawn — editorial cuteness, not a dashboard.
 *   The draggable anime/photo comparison is the product proof; the search pill
 *   is the only action that matters.
 * OWN-WORLD: leaf-green ground + leaf tile, ink text on green (AA), cream
 *   washi-taped tilted frame, teal accents, gold CTA, nook pastel chips,
 *   animal-card-pattern-default for route evidence (package design language).
 * STORY: "an anime scene → a route you can walk today". The slider proves it
 *   before any copy is parsed.
 * FIRST VIEWPORT: top bar (torii lockup + login) → left column: eyebrow chip,
 *   rounded headline with gold sticker accent, lead, search, pastel chips →
 *   right column: tilted comparison frame. The hero owns the whole first
 *   screen (main is grid-rows-[auto_1fr_auto]); the output-sample row was cut
 *   2026-08-30 as premature — the comparison alone is the proof for now.
 *   Mascot stays shelved — the
 *   owner judged the current fox set mismatched with this world (2026-08-30).
 * FORM: free round, code-led. Cherry-crossing pair recovered from git history
 *   (compare/anime.jpg + real.jpg, deleted with the old landing in b68aca51c).
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 *   finish review, the verdict, DESIGN.md, and every shipping raster carrying
 *   its provenance.
 */

const REPO_URL = "https://github.com/lifeodyssey/animichi";
const COMPARE = {
  anime: "/images/landing/compare/anime.jpg",
  real: "/images/landing/compare/real.jpg",
} as const;
const CHIP_COLORS = ["bg-nook-yellow", "bg-nook-teal", "bg-nook-pink"] as const;

/** Two-tone lockup: ink first half, teal chip on the second. */
function BrandLockup({ landing }: Readonly<{ landing: Dict["landing"] }>) {
  return (
    <span className="flex items-center gap-2.5">
      <img src="/images/landing/torii.svg" alt="" width={40} height={40} />
      <span className="font-body text-2xl font-black text-ground-ink">{landing.brand_pre}<span className="ml-1 rounded-lg bg-primary px-2 py-0.5 text-primary-ink">{landing.brand_accent}</span></span>
    </span>
  );
}

function useLoginModal(): readonly [boolean, () => void, () => void] {
  const [open, setOpen] = useState(false);
  return [open, () => { setOpen(true); }, () => { setOpen(false); }] as const;
}

/** The login modal lives in the top bar next to its trigger; `position: fixed`
 * frees it from the header box. */
function TopBar({ landing }: Readonly<{ landing: Dict["landing"] }>) {
  const [loginOpen, showLogin, hideLogin] = useLoginModal();
  return (
    <header className="flex w-full max-w-7xl items-center justify-between py-6">
      <BrandLockup landing={landing} />
      <button type="button" onClick={showLogin} className="animal-btn animal-btn-primary animal-btn-large">{landing.login}</button>
      <LoginModal open={loginOpen} onClose={hideLogin} returnTarget="/chat" />
    </header>
  );
}

/** Rounded gothic sell line; the em is a gold sticker, box-cloned across lines. */
function HeroCopy({ landing }: Readonly<{ landing: Dict["landing"] }>) {
  return (
    <div className="grid justify-items-start gap-6 text-left">
      <span className="rounded-full bg-primary px-4 py-2 text-base font-black tracking-[0.12em] text-primary-ink">{landing.eyebrow}</span>
      <h1 className="m-0 max-w-[15ch] font-body text-[clamp(3rem,5.4vw,5.5rem)] font-black leading-[1.1] text-ground-ink">{landing.headline_pre}<em className="not-italic"><span className="box-decoration-clone inline rounded-xl bg-gold-soft px-2 text-ground-ink">{landing.headline_em}</span></em></h1>
      <p className="m-0 max-w-[34rem] text-xl leading-9 text-ground-ink">{landing.lead}</p>
    </div>
  );
}

function HomeSearch({ home }: Readonly<{ home: Dict["home"] }>) {
  return (
    <form action="/chat" method="get" className="flex w-full max-w-2xl flex-col items-stretch gap-3 text-lg [--animal-height-lg:60px] sm:flex-row sm:items-start">
      <span className="animal-input-wrapper animal-input-large flex-1"><input name="q" className="animal-input-control" placeholder={home.search_placeholder} aria-label={home.search_placeholder} /></span>
      <span className="[--animal-bg-color:var(--color-gold)] [--animal-text-color:var(--color-gold-ink)]"><button type="submit" className="animal-btn animal-btn-primary animal-btn-large w-full sm:w-auto">{home.search_cta}</button></span>
    </form>
  );
}

/** Document load on purpose, like the app bar's new-conversation anchor
 * (`ChatAppBar.tsx:53`): `?q=` opens a NEW conversation, and only a cold start
 * can guarantee that — a client navigation cannot reset a live scope. */
function ChipLink({ query, color }: Readonly<{ query: string; color: string }>) {
  return <a href={`/chat?q=${encodeURIComponent(query)}`} className={`rounded-full px-6 py-3 text-lg font-bold text-nook-ink no-underline shadow-[var(--shadow-press)] transition-transform duration-100 hover:-translate-y-0.5 active:translate-y-1 active:shadow-none ${color}`}>{query}</a>;
}

function ExampleChips({ examples }: Readonly<{ examples: readonly string[] }>) {
  return (
    <div className="flex flex-wrap gap-3">
      {examples.map((q, i) => <ChipLink key={q} query={q} color={CHIP_COLORS[i % CHIP_COLORS.length] ?? CHIP_COLORS[0]} />)}
    </div>
  );
}

function useReveal(): readonly [number, (event: ChangeEvent<HTMLInputElement>) => void] {
  const [reveal, setReveal] = useState(50);
  const onChange = (event: ChangeEvent<HTMLInputElement>) => { setReveal(Number(event.target.value)); };
  return [reveal, onChange] as const;
}

/** One half of the comparison; the clipped copy reveals the anime frame. */
function ComparePane({ src, alt, label, clipped }: Readonly<{ src: string; alt: string; label: string; clipped: boolean }>) {
  return (
    <div className={clipped ? "absolute inset-0 [clip-path:inset(0_calc(100%_-_var(--reveal))_0_0)]" : "relative"}>
      <img src={src} alt={alt} className="aspect-video h-full w-full object-cover" />
      <span className={`absolute rounded-full bg-overlay px-2.5 py-1 text-xs font-bold text-primary-fg ${clipped ? "left-3 top-3" : "bottom-3 right-3"}`}>{label}</span>
    </div>
  );
}

function SeamArrows() {
  return (
    <svg viewBox="0 0 16 10" aria-hidden="true" className="size-4 fill-primary-strong">
      <path d="M5 1 1 5l4 4z" />
      <path d="M11 1l4 4-4 4z" />
    </svg>
  );
}

/** Draggable seam: an invisible range input spans the frame; the seam line and
 * knob ride the inherited `--reveal` so keyboard and touch both work. */
function SeamHandle({ value, onChange, label }: Readonly<{ value: number; onChange: (event: ChangeEvent<HTMLInputElement>) => void; label: string }>) {
  return (
    <>
      <div className="pointer-events-none absolute inset-y-0 left-[var(--reveal)] w-0.5 -translate-x-1/2 bg-paper" />
      <div className="pointer-events-none absolute top-1/2 left-[var(--reveal)] grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-primary bg-paper shadow-[var(--shadow-press)]"><SeamArrows /></div>
      <input type="range" min={0} max={100} value={value} onChange={onChange} aria-label={label} className="absolute inset-0 size-full cursor-ew-resize opacity-0" />
    </>
  );
}

function CompareSlider({ landing }: Readonly<{ landing: Dict["landing"] }>) {
  const [reveal, onChange] = useReveal();
  return (
    <div className="relative overflow-hidden rounded-lg" style={{ "--reveal": `${String(reveal)}%` } as CSSProperties}>
      <ComparePane src={COMPARE.real} alt={landing.comparison_real_alt} label={landing.comparison_real} clipped={false} />
      <ComparePane src={COMPARE.anime} alt={landing.comparison_anime_alt} label={landing.comparison_anime} clipped />
      <SeamHandle value={reveal} onChange={onChange} label={landing.comparison_aria} />
    </div>
  );
}

/** The washi-taped tilted postcard frame around the comparison. */
function CompareCard({ landing }: Readonly<{ landing: Dict["landing"] }>) {
  return (
    <div className="relative rotate-[3deg] rounded-2xl border-[12px] border-paper bg-paper shadow-[var(--shadow-press)]">
      <span className="absolute -top-4 left-10 h-5 w-16 -rotate-6 rounded-sm bg-primary-soft/80" />
      <span className="absolute -bottom-4 right-10 h-5 w-16 rotate-3 rounded-sm bg-primary-soft/80" />
      <CompareSlider landing={landing} />
    </div>
  );
}

function FooterLinks({ landing }: Readonly<{ landing: Dict["landing"] }>) {
  return (
    <nav aria-label={landing.footer_nav} className="flex gap-5">
      <Link to="/privacy" className="text-ground-ink underline underline-offset-4">{landing.privacy}</Link>
      <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-ground-ink underline underline-offset-4">{landing.github}</a>
    </nav>
  );
}

function LandingFooter({ landing }: Readonly<{ landing: Dict["landing"] }>) {
  return (
    <footer className="flex w-full max-w-7xl items-center justify-between pt-10 text-base font-bold">
      <span className="text-ground-ink">Animichi</span>
      <FooterLinks landing={landing} />
    </footer>
  );
}

function HeroLeft({ dict }: Readonly<{ dict: Dict }>) {
  return (
    <div className="grid justify-items-start gap-7">
      <HeroCopy landing={dict.landing} />
      <HomeSearch home={dict.home} />
      <ExampleChips examples={dict.landing.examples} />
    </div>
  );
}

function HeroGrid({ dict }: Readonly<{ dict: Dict }>) {
  return (
    <section className="grid w-full max-w-7xl items-center gap-16 py-6 lg:grid-cols-[5fr_6fr]">
      <HeroLeft dict={dict} />
      <CompareCard landing={dict.landing} />
    </section>
  );
}

const MAIN_CLASS = "grid min-h-dvh grid-rows-[auto_1fr_auto] justify-items-center overflow-x-clip px-6 pb-6 text-ground-ink [background-color:var(--color-ground)] [background-image:var(--leaf-tile-image)] [background-size:clamp(90px,18vw,260px)] night:[--animal-bg-color-content:var(--color-card)] night:[--animal-text-color-body:var(--color-fg)]";

function LandingSections({ dict }: Readonly<{ dict: Dict }>) {
  return (
    <>
      <HeroGrid dict={dict} />
      <LandingFooter landing={dict.landing} />
    </>
  );
}

/** The indexable body of `/` (owner 2026-08-23; from-zero direction-E round
 * 2026-08-30). Mobile hands off to /chat on the first effect; the search form
 * is a plain GET to /chat?q=… so it works before hydration. Log in opens the
 * magic-link modal in place — the visitor stays on the postcard, and the
 * mailed link carries them into /chat. */
export function DoorwaySummary() {
  const dict = useDict();
  return (
    <main className={MAIN_CLASS}>
      <TopBar landing={dict.landing} />
      <LandingSections dict={dict} />
    </main>
  );
}
