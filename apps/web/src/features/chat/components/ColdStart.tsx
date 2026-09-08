import type { ChatDict } from "../i18n";

type Props = Readonly<{
  dict: ChatDict;
  onChip: (text: string) => void;
  disabled?: boolean;
}>;

/** Mockup `.start`: the cold-start region owns the panel's empty middle. */
const START_CLASS = "flex flex-1 flex-col items-center justify-center gap-[var(--chat-rhythm)] px-8 py-6 text-center text-ground-ink max-lg:justify-start max-lg:gap-3.5 max-lg:px-5 max-lg:py-2.5";
/* A plain 44px display heading — the library `Title` is a folded-ribbon banner
 * graphic (white on green), which cannot carry this look. */
const HEADING_CLASS = "m-0 max-w-[22ch] text-[44px] font-black leading-[1.15] max-lg:text-3xl";
const SUB_CLASS = "m-0 text-base font-bold opacity-70 max-lg:text-sm";
const ENTRIES_CLASS = "mt-1.5 grid w-full max-w-[860px] gap-4 text-left [grid-template-columns:repeat(3,minmax(0,1fr))] max-lg:mt-1 max-lg:gap-3 max-lg:[grid-template-columns:1fr]";

/** The keyboard ring on the new chrome: ground-ink flips with the theme, so
 * the same outline is the high-contrast ink on day cream and night pine. */
const FOCUS_RING = "focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ground-ink";

/** The three entry doors share one card language (mockup `.entry`), each in
 * its own accent — teal for anime, gold for a city, leaf green for free chat.
 * The explicit `text-left` beats the UA button centering. Not the library
 * `Card`: its color variants are hardcoded day-only hexes that cannot flip at
 * night, its hover lifts where this grammar presses, and it renders a div —
 * the doors must stay real buttons for the keyboard and the disabled state. */
const ENTRY_CLASS = `grid cursor-pointer gap-[30px] rounded-[18px] border-[3px] px-[var(--chat-rhythm)] pb-4 pt-[var(--chat-rhythm)] text-left text-ground-ink shadow-[var(--shadow-press-sm)] transition-transform duration-100 active:translate-y-0.5 active:shadow-[0_1px_0_var(--shadow-3d)] disabled:cursor-not-allowed disabled:opacity-55 max-lg:gap-0 max-lg:px-4 max-lg:py-3.5 ${FOCUS_RING}`;
/* Per-door accent pairs. The gold and leaf tokens flip at night by theme, so
 * only the teal door carries night classes (primary-strong is theme-invariant
 * and falls to 2.34:1 on the night soft-teal card — under AA for a 16px
 * title). Every door borders in its own ink: the solid gold reads 1.35:1 on
 * the cream paper, far under the 3:1 an operable boundary needs. */
const ENTRY_TEAL = { card: "border-primary-strong bg-primary-soft night:border-primary", accent: "text-primary-strong night:text-primary" } as const;
const ENTRY_GOLD = { card: "border-gold-fg bg-gold-soft", accent: "text-gold-fg" } as const;
const ENTRY_WALK = { card: "border-walk-fg bg-walk-bg", accent: "text-walk-fg" } as const;
const ENTRY_TOP_CLASS = "flex items-center justify-between max-lg:mb-1";
const ENTRY_TITLE_CLASS = "text-base font-black";
/* The sample link is 13.5px text: deep teal on night paper is 3.04:1, so at
 * night it speaks the bright teal (7.25:1), the swap the deleted CSS made. */
const SAMPLE_CLASS = `m-0 inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent text-[13.5px] font-black text-primary-strong night:text-primary ${FOCUS_RING}`;

function BookIcon() {
  return (
    <svg className="size-6 stroke-primary-strong night:stroke-primary" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

type EntryDef = Readonly<{ title: string; prompt: string; icon: typeof BookIcon; card: string; accent: string }>;

function entryDefs(dict: ChatDict): readonly [EntryDef, EntryDef, EntryDef] {
  return [
    { title: dict.entryAnimeTitle, prompt: dict.entryAnimePrompt, icon: BookIcon, ...ENTRY_TEAL },
    { title: dict.entryCityTitle, prompt: dict.entryCityPrompt, icon: PinIcon, ...ENTRY_GOLD },
    { title: dict.entryChatTitle, prompt: dict.entryChatPrompt, icon: ChatIcon, ...ENTRY_WALK },
  ];
}

function EntryCard({ def, disabled, onPick }: Readonly<{ def: EntryDef; disabled: boolean; onPick: () => void }>) {
  const Icon = def.icon;
  const arrow = <span className="font-black opacity-50" aria-hidden="true">→</span>;
  return (
    <button type="button" className={`${ENTRY_CLASS} ${def.card}`} disabled={disabled} onClick={onPick}><span className={`${ENTRY_TOP_CLASS} ${def.accent}`}><Icon />{arrow}</span><span className={`${ENTRY_TITLE_CLASS} ${def.accent}`}>{def.title}</span></button>
  );
}

function EntryCards({ dict, disabled, onChip }: Readonly<{ dict: ChatDict; disabled: boolean; onChip: (text: string) => void }>) {
  const defs = entryDefs(dict);
  return (
    <div className={ENTRIES_CLASS}>
      {defs.map((def) => (
        <EntryCard key={def.title} def={def} disabled={disabled} onPick={() => { onChip(def.prompt); }} />
      ))}
    </div>
  );
}

function SampleLink({ dict, disabled, onChip }: Readonly<{ dict: ChatDict; disabled: boolean; onChip: (text: string) => void }>) {
  return (
    <button type="button" className={SAMPLE_CLASS} disabled={disabled} onClick={() => { onChip(dict.samplePrompt); }}>
      {dict.sampleLink}
    </button>
  );
}

/** A1 cold start (direction-E mockup `.start`): headline, one-line sub, the
 * three entry doors, and the sample-conversation link. Every door sends its
 * prompt down the existing send path — no new transport, no prefill state. */
export function ColdStart({ dict, onChip, disabled = false }: Props) {
  const sub = <p className={SUB_CLASS}>{dict.coldStartSub}</p>;
  return (
    <section className={START_CLASS} aria-label={dict.coldStartHeading}><h1 className={HEADING_CLASS}>{dict.coldStartHeading}</h1>{sub}<EntryCards dict={dict} disabled={disabled} onChip={onChip} /><SampleLink dict={dict} disabled={disabled} onChip={onChip} /></section>
  );
}
