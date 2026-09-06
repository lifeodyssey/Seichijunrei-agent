import type { ChatDict } from "../i18n";

/** Mockup `.mainhead`: breadcrumb + journey title left, the autosaved pill
 * right. The dashed rule parts the header from the conversation below. */
const HEADER_CLASS = "flex items-center justify-between border-b-2 border-dashed border-ground-ink/20 px-7 pb-[18px] pt-[18px] max-lg:border-b-0 max-lg:px-5 max-lg:pb-0 max-lg:pt-1";
const CRUMB_CLASS = "text-xs font-black opacity-70";
const TITLE_CLASS = "m-0 mt-0.5 text-lg font-black";
/* Night: the deep teal reads only 2.34:1 on the night soft-teal chip, so the
 * pill's text flips to the bright teal (5.5:1), like the cold-start accents.
 * The shape is the library Tag's (`animal-tag`: pill radius, inline-flex,
 * no-wrap); its `app-teal` palettes are hardcoded day-only hexes that cannot
 * flip with the theme, so the token pair stays ours via utilities. */
const SAVED_CLASS = "animal-tag gap-1.5 border-[2.5px] border-primary bg-primary-soft px-3.5 py-[5px] text-xs font-black text-primary-strong night:text-primary max-lg:[display:none]";

/** The panel's own chrome: where the visitor is (the crumb), what this
 * conversation is (the title), and that their words are not lost (autosaved). */
export function ChatHeader({ dict }: Readonly<{ dict: ChatDict }>) {
  const crumb = <div><div className={CRUMB_CLASS}>{dict.crumbJourneys}</div><p className={TITLE_CLASS}>{dict.titleNewJourney}</p></div>;
  const saved = <span className={SAVED_CLASS}><span aria-hidden="true">●</span>{dict.autosaved}</span>;
  return <header className={HEADER_CLASS}>{crumb}{saved}</header>;
}
