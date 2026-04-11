# SEO + GEO (Generative Engine Optimization) Spec

> **Update (2026-04-11):** Not started. All tasks remain. Site is still a client-side SPA behind auth with no public content pages. The main page (`frontend/app/page.tsx`) renders `<AuthGate />` -- crawlers see nothing useful. No `sitemap.xml`, no `robots.txt`, no JSON-LD, no `og:image`. The `layout.tsx` has a minimal title/description and partial OG tags (url only, no image/type/locale). `next.config.ts` confirms `output: "export"` (static export), which means **no SSR/SSG for dynamic meta tags** -- all structured data and meta must be baked into the static HTML at build time or injected client-side (which crawlers may not execute). The worker routes all non-`/v1/` and non-`/img/` requests to the `ASSETS` binding (static files). Three app pages exist (`page.tsx`, `auth/callback/page.tsx`, `settings/page.tsx`) -- all behind auth.

## Context

SEO audit on 2026-04-08 scored the site **35/100**. AI visibility score: **~5/100**. The site is a client-side SPA behind auth. Google and AI crawlers see a loading spinner and nothing else. Zero backlinks, no sitemap, no structured data, no public content pages.

**Current state:**
- Title + meta description exist (Japanese only)
- OG tags partially set (no og:image)
- No sitemap.xml
- No JSON-LD structured data
- No hreflang tags
- SPA renders client-side only (no SSR/SSG content for crawlers)
- No public-facing content pages (blog, anime guides, spot pages)
- Zero presence in AI responses for anime pilgrimage queries

**Competitors with strong SEO/GEO:**
- Anitabi.cn — indexed anime spot database, appears in AI responses
- Butaitanbou.com — Japanese anime pilgrimage blog, ranks well
- Individual travel blog posts dominate search results

## Goals

1. Google can index public landing page + future anime pages
2. Structured data (JSON-LD) on every page
3. Sitemap + robots.txt properly configured
4. og:image for social sharing
5. hreflang for ja/zh/en
6. Foundation for AI visibility (content that AI can cite)

## Non-Goals (next iteration)

- No blog/content section yet (requires content strategy + writing)
- No individual anime landing pages yet (requires SSG + data pipeline)
- No Reddit/community seeding yet
- No Xiaohongshu content yet

## Task Breakdown

### Task 1: Sitemap + Robots.txt

**Files:** `frontend/next.config.ts`, `frontend/public/robots.txt`, `frontend/public/sitemap.xml`

> **Note (2026-04-11):** `next-sitemap` requires `getServerSideProps` or API routes, which are unavailable with `output: "export"`. Use a manual static `sitemap.xml` in `frontend/public/` instead. Neither `robots.txt` nor `sitemap.xml` exist yet. The worker serves all non-API paths from the `ASSETS` binding, so files in `frontend/public/` (which end up in `frontend/out/`) will be served correctly.

- Add manual `sitemap.xml` in `frontend/public/`
- Add `robots.txt` in `frontend/public/` with `Sitemap:` directive
- Ensure AI training bots are not blocked (check content-signal headers)

**AC:**
- [ ] `https://seichijunrei.zhenjia.org/sitemap.xml` returns valid XML
- [ ] `https://seichijunrei.zhenjia.org/robots.txt` includes Sitemap directive

### Task 2: Structured Data (JSON-LD)

**Files:** `frontend/app/layout.tsx`

> **Note (2026-04-11):** Current `layout.tsx` has: `title: "聖地巡礼"`, `description: "アニメ聖地を探す・ルートを計画する"`, `metadataBase`, `alternates.canonical`, and `openGraph.url` (but no `og:image`, `og:type`, or `og:locale`). JSON-LD `<script>` tags can be added directly in the layout body since Next.js static export renders them into the HTML.

Add to layout:
```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "聖地巡礼 Seichijunrei",
  "url": "https://seichijunrei.zhenjia.org",
  "description": "Anime pilgrimage spot search and route planning",
  "inLanguage": ["ja", "zh", "en"],
  "potentialAction": {
    "@type": "SearchAction",
    "target": "https://seichijunrei.zhenjia.org/?q={search_term_string}",
    "query-input": "required name=search_term_string"
  }
}
```

Also add Organization schema:
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Seichijunrei",
  "url": "https://seichijunrei.zhenjia.org",
  "logo": "https://seichijunrei.zhenjia.org/logo.png"
}
```

**AC:**
- [ ] JSON-LD visible in page source
- [ ] Google Rich Results Test validates schema

### Task 3: Open Graph Image + Social Meta

**Files:** `frontend/app/layout.tsx`, `frontend/public/og-image.png`

- Create og:image (1200x630): 聖地巡礼 heading + map pins + anime scene comparison
- Add `og:image`, `og:type`, `og:locale`, `og:locale:alternate`
- Add `twitter:image`, `twitter:card: summary_large_image`

**AC:**
- [ ] Social share preview shows image on Twitter/LINE/WeChat
- [ ] og:locale set for ja, alternates for zh/en

### Task 4: Hreflang Tags

**Files:** `frontend/app/layout.tsx`

Add to head:
```html
<link rel="alternate" hreflang="ja" href="https://seichijunrei.zhenjia.org/" />
<link rel="alternate" hreflang="zh" href="https://seichijunrei.zhenjia.org/?lang=zh" />
<link rel="alternate" hreflang="en" href="https://seichijunrei.zhenjia.org/?lang=en" />
<link rel="alternate" hreflang="x-default" href="https://seichijunrei.zhenjia.org/" />
```

**AC:**
- [ ] hreflang tags in page source
- [ ] Google sees 3 language versions

### Task 5: Improve Meta Description + Title

**Files:** `frontend/app/layout.tsx`

> **Note (2026-04-11):** Current title is `聖地巡礼` (4 chars, too short). Current description is `アニメ聖地を探す・ルートを計画する` (16 chars, too short). Both set via Next.js `metadata` export, which works correctly with static export.

- Title: `聖地巡礼 — アニメの聖地を探す・ルートを計画する | Seichijunrei`
- Description: `アニメの聖地巡礼スポットを検索し、ルートを計画。2,400以上のロケ地、180以上の作品をカバー。君の名は、響け！ユーフォニアム、ヴァイオレット・エヴァーガーデンなど。`
- Longer, keyword-rich, includes anime titles that people search for

**AC:**
- [ ] Title 50-60 chars
- [ ] Description 120-160 chars with target keywords

### Task 6: FAQ Schema for AI Visibility

**Files:** `frontend/app/layout.tsx` or new component

Add FAQ JSON-LD:
```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "聖地巡礼（アニメの聖地巡り）とは？",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "聖地巡礼とは、アニメや漫画の舞台となった実在の場所を訪れること。Seichijunreiでは2,400以上のスポットを検索し、ルートを計画できます。"
      }
    },
    {
      "@type": "Question",
      "name": "How to find anime filming locations in Japan?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Use Seichijunrei to search by anime title. We cover 180+ anime with 2,400+ verified filming locations across all 47 prefectures of Japan."
      }
    }
  ]
}
```

**AC:**
- [ ] FAQ schema validates in Google Rich Results Test
- [ ] Content answers questions AI models commonly receive

## Constraints (2026-04-11)

- **Static export only:** `next.config.ts` uses `output: "export"`. No `getServerSideProps`, no API routes, no dynamic rendering. All meta/structured data must be static.
- **All pages behind auth:** `page.tsx` renders `<AuthGate />`. Crawlers cannot access app content. A public landing page (or at minimum a pre-auth shell with visible meta) is prerequisite for any SEO to be effective.
- **Worker routing:** `worker/worker.js` serves non-API paths from the CF `ASSETS` binding. No special SEO routing exists. `sitemap.xml` and `robots.txt` placed in `frontend/public/` will be served automatically.
- **No `og:image` asset exists yet.** Needs design/creation before Task 3.

## Iteration Phases

All tasks can run in parallel (single file: layout.tsx, but different sections).
Recommended: one PR with all 6 tasks since they're all metadata changes.

## Verification

1. Google Rich Results Test: validate structured data
2. Facebook Sharing Debugger: verify og:image
3. Twitter Card Validator: verify card preview
4. Check `view-source:` for all meta tags
5. Lighthouse SEO score target: 90+
