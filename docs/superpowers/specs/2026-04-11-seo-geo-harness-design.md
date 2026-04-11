# SEO + GEO Foundation — Harness-Compliant Spec

## Context

SEO audit on 2026-04-08 scored the site **35/100 (Google)** and **~5/100 (AI visibility)**. The original spec lives at `docs/superpowers/specs/2026-04-08-seo-geo-design.md`. No tasks from that spec have been implemented.

**Current state (verified 2026-04-11):**

- `frontend/app/layout.tsx`: title `聖地巡礼` (4 chars), description `アニメ聖地を探す・ルートを計画する` (16 chars), partial `openGraph` (url only — no `og:image`, `og:type`, `og:locale`)
- `frontend/app/page.tsx`: renders `<AuthGate />` — crawlers see an empty client-side shell
- `frontend/next.config.ts`: `output: "export"`, `trailingSlash: true` — no SSR/SSG, no API routes, no dynamic rendering
- `worker/worker.js`: non-`/v1/` and non-`/img/` paths served from `ASSETS` binding — files in `frontend/public/` (built to `frontend/out/`) are served directly
- `frontend/public/`: contains only SVGs (`empty-map.svg`, `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`) — no `robots.txt`, no `sitemap.xml`, no `og-image.png`, no `logo.png`
- Three app pages exist (`page.tsx`, `auth/callback/page.tsx`, `settings/page.tsx`) — all behind auth
- Zero JSON-LD, zero hreflang tags, zero FAQ schema

## Goals

1. Crawlers (Google, Bing, AI training bots) can discover and index the public landing page
2. Valid `sitemap.xml` and `robots.txt` served at root
3. JSON-LD structured data (WebSite + Organization + FAQPage) embedded in static HTML
4. Complete Open Graph and Twitter Card meta for social sharing (including `og:image`)
5. `hreflang` tags for ja/zh/en language variants
6. Keyword-rich title (50-60 chars) and description (120-160 chars)
7. Lighthouse SEO score target: 90+

## Non-Goals

- **No public content pages** (blog, anime guides, per-anime landing pages) — requires content strategy and SSG pipeline, deferred to a future iteration
- **No dynamic OG images** (per-anime or per-route Worker-generated images) — deferred; this iteration adds a single static `og-image.png`
- **No community seeding** (Reddit, Xiaohongshu) — separate marketing effort
- **No SSR/ISR migration** — the site stays on `output: "export"`
- **No pre-auth public landing page redesign** — the `<AuthGate />` remains; SEO value comes from meta tags and structured data visible in the static HTML shell

## Layout/Design Decision

No UI layout changes. All work is metadata (head tags, JSON-LD scripts, static files). The visible page remains `<AuthGate />`.

## Architecture

### How SEO works with static export + Cloudflare Worker

```
Build time (next build → frontend/out/)
  ├── index.html          ← contains <title>, <meta>, <link rel="alternate">,
  │                          <script type="application/ld+json"> in <head>/<body>
  ├── sitemap.xml         ← static file from frontend/public/
  ├── robots.txt          ← static file from frontend/public/
  └── og-image.png        ← static asset from frontend/public/

Runtime (Cloudflare Worker)
  ├── GET /sitemap.xml    → ASSETS binding → frontend/out/sitemap.xml
  ├── GET /robots.txt     → ASSETS binding → frontend/out/robots.txt
  ├── GET /og-image.png   → ASSETS binding → frontend/out/og-image.png
  └── GET /               → ASSETS binding → frontend/out/index.html
                              (crawler reads <head> meta + JSON-LD from static HTML)
```

**Key constraint:** `output: "export"` means all meta tags are baked into `index.html` at build time via Next.js `metadata` export in `layout.tsx`. JSON-LD `<script>` tags are rendered into the static HTML body. No server-side injection is possible.

**Worker changes:** None required. The worker already serves all non-`/v1/` and non-`/img/` paths from the `ASSETS` binding. New static files in `frontend/public/` will be served automatically.

### Files changed (summary)

| File | Change |
|------|--------|
| `frontend/app/layout.tsx` | Enhanced `metadata` export; JSON-LD `<script>` tags in body |
| `frontend/public/robots.txt` | New file |
| `frontend/public/sitemap.xml` | New file |
| `frontend/public/og-image.png` | New file (1200x630 static asset) |

## Task Breakdown

### Task 1: Sitemap + Robots.txt

- **Scope:** Add static `sitemap.xml` and `robots.txt` to `frontend/public/`. These are copied verbatim to `frontend/out/` during build and served by the Worker's ASSETS binding.
- **Files changed:**
  - `frontend/public/sitemap.xml` (create)
  - `frontend/public/robots.txt` (create)
- **AC (with mandatory categories):**
  - [ ] Happy path: `sitemap.xml` is well-formed XML with `<urlset>` root, contains `<url>` entry for `https://seichijunrei.zhenjia.org/`, includes `<lastmod>` and `<changefreq>` -> unit
  - [ ] Happy path: `robots.txt` contains `User-agent: *`, `Allow: /`, and `Sitemap: https://seichijunrei.zhenjia.org/sitemap.xml` directive -> unit
  - [ ] Null/empty: `sitemap.xml` with only the root URL is still valid (no anime-specific URLs yet) -> unit
  - [ ] Error path: `robots.txt` does not block known AI training bots (GPTBot, Google-Extended, CCBot, anthropic-ai) — verify no `Disallow` rules for these user agents -> unit
- **Quality Ratchet:** all ACs annotated with test type

### Task 2: JSON-LD Structured Data (WebSite + Organization)

- **Scope:** Add two JSON-LD `<script type="application/ld+json">` blocks in `layout.tsx` body: `WebSite` schema (with `SearchAction`) and `Organization` schema. Uses Next.js `metadata` export for structured data or inline `<script>` tags in the JSX body.
- **Files changed:**
  - `frontend/app/layout.tsx` (modify)
- **AC (with mandatory categories):**
  - [ ] Happy path: page source contains a valid `WebSite` JSON-LD block with `@type: "WebSite"`, `name`, `url`, `description`, `inLanguage: ["ja", "zh", "en"]`, and `potentialAction` of type `SearchAction` -> unit
  - [ ] Happy path: page source contains a valid `Organization` JSON-LD block with `@type: "Organization"`, `name`, `url`, `logo` -> unit
  - [ ] Null/empty: JSON-LD blocks render correctly even when the page body is empty (AuthGate not yet mounted) — the `<script>` tags are in static HTML, not client-rendered -> unit
  - [ ] Error path: JSON-LD does not contain broken JSON (e.g., unescaped quotes, trailing commas) — validate with `JSON.parse()` -> unit
  - [ ] i18n: `inLanguage` array includes all three supported locales (`ja`, `zh`, `en`) -> unit
- **Quality Ratchet:** all ACs annotated with test type

### Task 3: Open Graph Image + Social Meta

- **Scope:** Create a static `og-image.png` (1200x630) and add complete OG and Twitter Card meta tags via the Next.js `metadata` export in `layout.tsx`.
- **Files changed:**
  - `frontend/public/og-image.png` (create — design asset)
  - `frontend/app/layout.tsx` (modify)
- **AC (with mandatory categories):**
  - [ ] Happy path: `metadata.openGraph` includes `images` array with URL `https://seichijunrei.zhenjia.org/og-image.png`, `width: 1200`, `height: 630`, `type: "website"`, `locale: "ja_JP"`, and `alternateLocale: ["zh_CN", "en_US"]` -> unit
  - [ ] Happy path: `metadata.twitter` includes `card: "summary_large_image"` and `images` pointing to the OG image -> unit
  - [ ] Null/empty: `og-image.png` file exists in `frontend/public/` and has non-zero file size -> unit
  - [ ] Error path: OG image dimensions are exactly 1200x630 (social platforms reject other sizes or crop incorrectly) -> unit
  - [ ] i18n: `og:locale` set to `ja_JP`, alternates include `zh_CN` and `en_US` -> unit
- **Quality Ratchet:** all ACs annotated with test type

### Task 4: Hreflang Tags

- **Scope:** Add `<link rel="alternate" hreflang="...">` tags for ja, zh, en, and x-default via the Next.js `metadata.alternates.languages` export.
- **Files changed:**
  - `frontend/app/layout.tsx` (modify)
- **AC (with mandatory categories):**
  - [ ] Happy path: built HTML contains `<link rel="alternate" hreflang="ja">`, `hreflang="zh"`, `hreflang="en"`, and `hreflang="x-default"` with correct `href` values -> unit
  - [ ] Null/empty: `x-default` href points to the base URL without a `?lang=` parameter -> unit
  - [ ] Error path: no duplicate hreflang tags for the same language code in the rendered HTML -> unit
- **Quality Ratchet:** all ACs annotated with test type

### Task 5: Enhanced Title + Meta Description

- **Scope:** Replace the current minimal title and description with keyword-rich, length-optimized versions. Update `metadata.title` and `metadata.description` in `layout.tsx`.
- **Files changed:**
  - `frontend/app/layout.tsx` (modify)
- **AC (with mandatory categories):**
  - [ ] Happy path: `<title>` tag content is 50-60 characters and includes both Japanese text and the English brand name "Seichijunrei" -> unit
  - [ ] Happy path: `<meta name="description">` content is 120-160 characters, includes target keywords (聖地巡礼, アニメ, ルート, スポット) and specific anime titles -> unit
  - [ ] Null/empty: title and description do not contain placeholder text or template variables -> unit
  - [ ] Error path: title does not exceed 60 characters (truncation risk in SERPs) -> unit
  - [ ] i18n: description is in Japanese (primary market), English brand name included for international discoverability -> unit
- **Quality Ratchet:** all ACs annotated with test type

### Task 6: FAQ Schema for AI Visibility (GEO)

- **Scope:** Add a `FAQPage` JSON-LD block in `layout.tsx` with 2-4 Q&A pairs targeting common anime pilgrimage queries in Japanese and English. This is the GEO (Generative Engine Optimization) foundation — content that AI models can cite.
- **Files changed:**
  - `frontend/app/layout.tsx` (modify)
- **AC (with mandatory categories):**
  - [ ] Happy path: page source contains a valid `FAQPage` JSON-LD block with `@type: "FAQPage"` and at least 2 `Question`/`Answer` pairs -> unit
  - [ ] Happy path: FAQ answers include factual claims about the service (spot count, anime count) that AI models can extract and cite -> unit
  - [ ] Null/empty: FAQ JSON-LD renders even if there are zero questions (empty `mainEntity` array is valid schema but should not ship — verify at least 2 entries) -> unit
  - [ ] Error path: FAQ JSON-LD passes schema validation (no missing required fields: `name` on Question, `text` on Answer) -> unit
  - [ ] i18n: FAQ contains at least one question in Japanese and one in English -> unit
  - [ ] Multi-turn: an AI model (ChatGPT/Claude/Gemini) asked "What is seichijunrei?" or "How to find anime locations in Japan?" can extract and cite information from the FAQ schema -> eval
- **Quality Ratchet:** all ACs annotated with test type

## Verification Plan

1. **Build verification:** `npm run build` in `frontend/` succeeds; `frontend/out/` contains `index.html`, `sitemap.xml`, `robots.txt`, `og-image.png`
2. **Static file serving:** deploy to staging; `curl -s https://seichijunrei.zhenjia.org/sitemap.xml` returns valid XML; `curl -s https://seichijunrei.zhenjia.org/robots.txt` returns expected content
3. **Meta tag verification:** `view-source:` on the deployed page shows all expected `<meta>`, `<link>`, and `<script type="application/ld+json">` tags
4. **Schema validation:** paste page URL into [Google Rich Results Test](https://search.google.com/test/rich-results) — WebSite, Organization, and FAQPage schemas all validate without errors
5. **Social preview:** paste URL into [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) and Twitter Card Validator — image renders at 1200x630
6. **Lighthouse:** run Lighthouse SEO audit on deployed page — target score 90+
7. **Unit tests:** all AC unit tests pass via `npm test` (or `vitest run`) in the frontend directory

## Dependencies

- **OG image asset:** Task 3 requires a designed 1200x630 PNG. This can be a simple branded graphic (site name + map pins illustration). No external design tool dependency — can be generated programmatically or as a static asset.
- **Frontend test runner:** Unit test ACs assume `vitest` is set up in the frontend. If not yet installed, the test infrastructure spec (`2026-04-08-test-infrastructure-design.md`) is a soft dependency. Alternatively, ACs can be verified manually via build output inspection until vitest is available.
- **No backend changes required.** All work is frontend-only (static files + metadata).
- **No Worker changes required.** The existing ASSETS routing handles all new static files.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `output: "export"` silently drops some `metadata` fields | Medium | High | Verify every meta tag in `frontend/out/index.html` after build, not just in dev mode |
| JSON-LD `<script>` tags not included in static export | Low | High | Next.js static export renders JSX body including `<script>` tags — verified behavior; add build-output unit test |
| OG image too large (slow to load) | Low | Medium | Compress to < 100KB; use PNG-8 or WebP with PNG fallback |
| FAQ schema content becomes stale (spot/anime counts change) | Medium | Low | Use approximate numbers ("2,400+", "180+"); update during content refreshes |
| hreflang with query params (`?lang=zh`) may confuse crawlers | Medium | Medium | Google supports query-param variants; alternatively use subpath (`/zh/`) in future iteration |
| Lighthouse score below 90 due to SPA hydration bundle size | Medium | Medium | SEO score is separate from performance score; meta tags alone should score 90+; monitor and address performance separately |
| AI models cannot access or cite the FAQ content because the page requires auth to render full content | High | Medium | JSON-LD is in the static HTML shell (not behind auth); AI training crawlers read the HTML source, not the rendered SPA — the structured data is visible regardless of AuthGate |
