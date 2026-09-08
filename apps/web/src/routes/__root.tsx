import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useMatches,
} from "@tanstack/react-router";
import { NotFound } from "../components/NotFound";
import { RootError } from "../components/RootError";
import { Splash } from "../components/Splash";
import { THEME_BOOTSTRAP_SCRIPT } from "../components/theme-bootstrap";
import { cfWebAnalyticsScripts } from "../features/seo/analytics";
import { SPLASH_SCRIPTING_MARK_SCRIPT } from "../features/splash/splash-release";
import { currentRuntimeConfig, RUNTIME_CONFIG_GLOBAL_KEY } from "../lib/runtime-config/provider";
import { useFieldVitals } from "../features/telemetry/lib/use-field-vitals";
import { SITE_ICON_LINKS, SITE_META } from "../features/seo/head";
import { SITE_DESCRIPTION, SITE_TITLE } from "../features/seo/site";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "../i18n/locales";
import globalsUrl from "../styles/globals.css?url";

// First-screen key-weight faces (C8): with font-display: swap, a late webfont
// arrival reflows the page (CLS). Preloading the four faces actually
// referenced on the mobile first screen — Zen Maru Gothic 700
// (wordmark/bubble/CTA), Noto Serif JP 700 (title), Zen Maru Gothic 500
// (lead), Nunito 700 (Latin UI) — pulls them into the font cache during
// HTML parse, so first paint can use the webfont metrics directly. Bounded
// at four: more preloads just crowd the bandwidth budget while the
// metric-aligned fallbacks in fonts.css absorb any remaining swaps.
const FONT_PRELOADS = [
  { rel: "preload", href: "/fonts/zen-maru-gothic-japanese-700-normal.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "preload", href: "/fonts/noto-serif-jp-japanese-700-normal.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "preload", href: "/fonts/zen-maru-gothic-japanese-500-normal.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "preload", href: "/fonts/nunito-latin-700-normal.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
] as const;

interface RouterContext {
  readonly queryClient: QueryClient;
}

type RootDocumentProps = Readonly<{
  children: ReactNode;
}>;


/** Inline script that seeds the versioned runtime config global once (#1013).
 * Uses `?? ` so an earlier-set value (deploy injection or the E2E seam) wins
 * over the SSR default — the ONE artifact never re-bakes env after the browser
 * provides it. */
export function runtimeConfigInlineScript(config: ReturnType<typeof currentRuntimeConfig>): string {
  const key = JSON.stringify(RUNTIME_CONFIG_GLOBAL_KEY);
  const payload = JSON.stringify(config);
  return 'window[' + key + '] ??= ' + payload + ';';
}

const ROOT_LINKS = [
  { rel: "stylesheet", href: globalsUrl },
  ...FONT_PRELOADS,
  ...SITE_ICON_LINKS,
];

// Social-card defaults live at the root so every route has a card; deeper
// routes override `title` only, which is why og:title stays the site title.
const ROOT_META = [
  { charSet: "utf-8" },
  { name: "viewport", content: "width=device-width, initial-scale=1" },
  { title: SITE_TITLE },
  { name: "description", content: SITE_DESCRIPTION },
  ...SITE_META,
];

/** Pre-hydration theme init, the splash scripting mark (so the mobile index
 * splash only holds when JS can actually arrive), and the versioned runtime
 * config seed; the beacon joins only in PRODUCTION with a token (#1013). */
function rootScripts(config: ReturnType<typeof currentRuntimeConfig>) {
  return [
    { children: THEME_BOOTSTRAP_SCRIPT },
    { children: SPLASH_SCRIPTING_MARK_SCRIPT },
    ...cfWebAnalyticsScripts(config.cfBeaconToken, import.meta.env.PROD),
  ];
}

/** Root head, resolved per render so the runtime config is live (#1013). */
export function rootHead() {
  const config = currentRuntimeConfig();
  return { links: ROOT_LINKS, scripts: rootScripts(config), meta: ROOT_META };
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: rootHead,
  component: RootComponent,
  errorComponent: RootError,
  notFoundComponent: () => <NotFound />,
});

function RootComponent() {
  useFieldVitals();
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

interface LocaleBearingMatch {
  readonly loaderData?: unknown;
}

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

function localeOf(data: unknown): Locale | null {
  if (typeof data !== "object" || data === null || !("locale" in data)) return null;
  return isLocale(data.locale) ? data.locale : null;
}

/** SSR lang source: deepest locale-bearing match wins, else DEFAULT_LOCALE. */
export function langFromMatches(matches: readonly LocaleBearingMatch[]): Locale {
  for (const match of [...matches].reverse()) {
    const locale = localeOf(match.loaderData);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

interface RouteIdBearingMatch {
  readonly routeId: string;
}

/** The mobile splash dwell applies to the index route only; every other route
 * keeps the 320ms get-in-get-out splash (owner 2026-08-21). Resolved from the
 * matches, so SSR and hydration agree without reading `window`. */
export function isIndexMatch(matches: readonly RouteIdBearingMatch[]): boolean {
  return matches.at(-1)?.routeId === "/";
}

/** WCAG 2.4.1 Bypass Blocks: a keyboard-reachable "skip to content" link as
 * the page's first tab stop. It is visually hidden until it receives focus,
 * then jumps the user's focus into the route's main content region. */
export function skipLabel(lang: Locale): string {
  return lang === "ja" ? "コンテンツへ移動" : lang === "zh" ? "跳转到主要内容" : "Skip to content";
}

export function SkipLink({ lang }: { readonly lang: Locale }) {
  return (
    <a className="skip-link" href="#main-content">{skipLabel(lang)}</a>
  );
}

/** Body-level runtime-config seed (#1013), independent of head serialization. */
function RuntimeConfigSeed() {
  return (
    <script
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: runtimeConfigInlineScript(currentRuntimeConfig()) }}
    />
  );
}

function RootDocument({ children }: RootDocumentProps) {
  const matches = useMatches();
  const lang = langFromMatches(matches);
  return (
    <html lang={lang}>
      <head><HeadContent /></head>
      <body><Splash hold={isIndexMatch(matches)} /><SkipLink lang={lang} /><RuntimeConfigSeed /><div id="main-content" tabIndex={-1}>{children}</div><Scripts /></body>
    </html>
  );
}
