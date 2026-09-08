import { Link } from "@tanstack/react-router";
import { useDict } from "../../i18n/LocaleProvider";
import type { Dict } from "../../i18n/dictionaries";

type PrivacyCopy = Dict["privacy"];

interface SectionProps {
  readonly heading: string;
  readonly body: string;
}

const BODY_TEXT = "leading-[1.8] text-muted-fg";
const SECTION_GRID = "grid gap-6.5";
const STRONG_LINK = "font-extrabold text-primary-strong";

function PrivacySection({ heading, body }: SectionProps) {
  return <section className="border-t border-border pt-6"><h2 className="mb-2 text-[1.2rem] text-fg">{heading}</h2><p className={BODY_TEXT}>{body}</p></section>;
}

function PrivacyCoreSections({ copy }: { copy: PrivacyCopy }) {
  return <div className={SECTION_GRID}>
    <PrivacySection heading={copy.account_heading} body={copy.account_body} />
    <PrivacySection heading={copy.product_heading} body={copy.product_body} />
    <PrivacySection heading={copy.browser_heading} body={copy.browser_body} />
    <PrivacySection heading={copy.sharing_heading} body={copy.sharing_body} />
    <PrivacySection heading={copy.choices_heading} body={copy.choices_body} />
  </div>;
}

function PrivacySafeguardSections({ copy }: { copy: PrivacyCopy }) {
  return <div className={SECTION_GRID}>
    <PrivacySection heading={copy.improvement_heading} body={copy.improvement_body} />
    <PrivacySection heading={copy.security_heading} body={copy.security_body} />
    <PrivacySection heading={copy.evaluation_heading} body={copy.evaluation_body} />
  </div>;
}

function PrivacyContact({ copy }: { copy: PrivacyCopy }) {
  return <aside className="mt-9.5 grid gap-1.5 rounded-2xl border-2 border-border bg-card p-5"><p className="font-extrabold">{copy.contact}</p><a className={STRONG_LINK} href="https://github.com/lifeodyssey/animichi/issues" target="_blank" rel="noreferrer">{copy.contact_link}</a></aside>;
}

function PrivacyHeader({ copy }: { copy: PrivacyCopy }) {
  return <header className="mb-9 grid gap-3.5"><p className="eyebrow">Animichi</p><h1 className="font-display text-[clamp(2.3rem,6vw,4.2rem)] leading-[1.1]" id="privacy-title">{copy.title}</h1><p className={BODY_TEXT}>{copy.updated}</p><p className="text-[0.9rem] font-extrabold leading-[1.8] text-muted-fg">{copy.version}</p><p className="max-w-3xl text-[1.08rem] leading-[1.8] text-muted-fg">{copy.intro}</p></header>;
}

/** Current data practices for the rebuilt web app, rendered in the active locale. */
export function PrivacyPolicy() {
  const copy = useDict().privacy;
  return <main className="mx-auto w-[min(860px,calc(100%_-_32px))] pt-8 pb-18" aria-labelledby="privacy-title">
    <div className="mb-10.5 flex items-center justify-between gap-4"><Link className="inline-block font-extrabold text-primary-strong no-underline hover:underline hover:underline-offset-[3px] focus-visible:underline focus-visible:underline-offset-[3px]" to="/">← {copy.back_home}</Link></div>
    <PrivacyHeader copy={copy} />
    <PrivacyCoreSections copy={copy} />
    <PrivacySafeguardSections copy={copy} />
    <PrivacyContact copy={copy} />
  </main>;
}
