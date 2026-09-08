# Prod Apex Activation + SEO Validation (P6 / #914)

Runbook for the **code-prepared** production-domain launch: activating
`animichi.com` as the web origin and validating the SEO surface on the apex.

The Pulumi prod stack deliberately ships **without** the launch config
(`webRoutesEnabled` stays `false`, see `infra/Pulumi.prod.yaml`). This document
is the owner's activation checklist — every step is HITL, none of it happens
from a deploy without the GitHub `production` environment approval.

## What is already in place (no code needed)

- SEO code, all committed and shipped with `apps/web`: `robots.txt`,
  `sitemap.xml`, `og-image.png` (1200x630), home JSON-LD (`WebSite` +
  `Organization`, `src/features/seo/home-structured-data.ts`), hreflang +
  canonical (`src/features/seo/head.ts`), IndexNow key file
  (`public/ab12ab12ab12ab12ab12ab12ab12ab12.txt`,
  `src/features/seo/indexnow.ts`). The static-files unit suite pins them.
- Core Web Vitals assertions in the single CI workflow's affected web lane — CLS
  blocking at 0.10, LCP warn at 2500ms. Thresholds live in
  `apps/web/web-cwv.config.ts`; `e2e/web-cwv.spec.ts` measures them with
  Playwright's PerformanceObserver API over 3 runs and asserts the median.
- Pulumi consumption logic: `infra/src/web-routes.ts` (apex Custom Domain on
  `animichi-web` + `/v1`, `/img`, `/tiles`, `/healthz` edge routes + www
  placeholder/301 + optional legacy-domain redirects) and
  `infra/src/hardening.ts` (DNSSEC, `/v1/*` rate limit, HSTS, CAA).

## Domain ownership — evidence + owner confirmation

Read-only verification performed for #914 (2026-08-09):

- **No CF API token was available locally** for a zone-list query (the repo's
  `CLOUDFLARE_API_TOKEN` is a GitHub secret, never local; the Pulumi R2 state
  backend is passphrase-encrypted and unreadable without the passphrase).
- **The zone provably exists in the account anyway**: the staging stack
  (`infra/Pulumi.staging.yaml`) uses `cloudflareZoneId`
  `44fdcc54545c1152a8e730137b671be4` with `stagingDomain: staging.animichi.com`,
  and staging has been **live** since #541 step 6 (2026-08-05). A Cloudflare
  Custom Domain for a subdomain requires the parent zone in the same account —
  so the `animichi.com` zone (id `44fdcc54545c1152a8e730137b671be4`) already
  lives in account `021233c1880a43aa68565496100e1f8c`.

**Owner HITL confirmation** (before activating): open Cloudflare dashboard →
your account → the `animichi.com` zone (id `44fd…`) and confirm (a) the zone
is in the account, (b) the plan permits the apex Custom Domain + the
4-issuer CAA set, (c) Universal SSL covers the apex.

## Activation steps (HITL — do NOT run in a PR you expect to auto-merge)

Order matters: hardening activates as soon as `cloudflareZoneId` is set (step
1), CAA on `webDomain` (step 2), and only `webRoutesEnabled` (step 4)
publishes the apex. The four committed keys are applied by CI's `deploy-prod`
job (`run_pulumi: true` is catalog-only; GitHub `production` environment
approval is the gate).

From `infra/`:

```bash
# 1. Zone hardening turns on here: DNSSEC + /v1 rate limit + HSTS.
pulumi config set cloudflareZoneId 44fdcc54545c1152a8e730137b671be4 --stack prod

# 2. CAA records pin the apex (4 issuers, hardening.ts).
pulumi config set webDomain animichi.com --stack prod

# 3. www placeholder + 301-to-apex ruleset (prod only).
pulumi config set wwwDomain www.animichi.com --stack prod

# 4. THE LAUNCH — apex Custom Domain + narrowed edge routes together.
pulumi config set webRoutesEnabled true --stack prod

# Optional, one entry per legacy domain (each needs its own CF zone, #545):
pulumi config set legacyRedirectZones '["<legacy zone id>"]' --stack prod
```

Commit `infra/Pulumi.prod.yaml`, merge, and let `deploy-prod` run behind the
`production` environment approval. See `docs/ops/deployment.md` for the apply
path.

### Rollback

The flag is one config line: set `webRoutesEnabled false`, merge, re-apply via
`deploy-prod`. This removes the Custom Domain and the narrowed routes
(`deleteBeforeReplace` semantics). Pulumi export/rollback backup: see
`docs/ops/deployment.md` → "Pulumi rollback".

## Post-activation verification

### 1. SEO verification script (this repo, re-runnable, read-only)

```bash
# from the repo root (the activation steps above ran from infra/ — cd .. first)
bash scripts/verify-prod-seo.sh
```

Checks (all against `https://animichi.com`):

| # | Check | Fails when |
|---|---|---|
| 1 | Home returns HTML (web Worker), not the edge JSON 404 | routes not narrowed / apex not on `animichi-web` |
| 2 | `robots.txt` has `Sitemap: https://animichi.com/sitemap.xml` + `Disallow: /v1/` | robots not shipped |
| 3 | `sitemap.xml` is a valid urlset with the apex `<loc>` + hreflang alternates | sitemap not shipped |
| 4 | `og-image.png` is a 1200x630 PNG | og asset missing/wrong size |
| 5 | Home JSON-LD: `WebSite` (with `SearchAction`) + `Organization` (with `logo`), both `url = https://animichi.com/` | structured data broken |
| 6 | Home head: `canonical` + `ja`/`zh`/`en`/`x-default` hreflang alternates | head wiring broken |
| 7 | IndexNow key file `/<key>.txt` serves the key verbatim (key read from the checked-in constant) | key file/constant drift or 404 |
| 8 | `/v1/` answers 401/403 (edge auth) and `/healthz` answers 200 | route narrowing mis-assigned |
| 9 | `www` 301s to the apex | www placeholder/redirect missing |

Exit 0 = all green; non-zero = at least one check failed (each failure is
printed). Safe to run before activation — a pre-launch run is expected to fail
checks 1 and 9 (no DNS yet). The script takes an optional origin argument for
read-only dry runs against other hosts; note staging is behind Cloudflare Access
(#1369) and answers a redirect to its login page without the
`CF-Access-Client-Id` / `CF-Access-Client-Secret` service-token headers.

### 2. Core Web Vitals (Playwright)

The affected web lane is already part of CI
per-package gates; no extra step. It reuses the build artifact, serves it with
`wrangler dev`, and runs `e2e/web-cwv.spec.ts` — Playwright reads CLS and LCP
in the page via the PerformanceObserver API over 3 navigations and asserts the
median. Thresholds are shared from `apps/web/web-cwv.config.ts`: CLS blocks at
0.10 and LCP warns at 2500ms. The CLS gate is the only hard assertion today;
per-run JSON reports land under `apps/web/lighthouse-reports/`.

### 3. Owner dashboard spot-checks

- Google Search Console / Bing Webmaster: submit `sitemap.xml`, confirm the
  IndexNow ping for the home URL is accepted.
- Rich-results test (or equivalent): home page parses `WebSite`/`Organization`
  without errors.

## Definition of done (all must hold)

- `scripts/verify-prod-seo.sh` exits 0 (9/9 checks).
- `Web / lighthouse` lane green on the activation push.
- Owner confirmed the apex zone + Universal SSL (dashboard).
- Search consoles accept the sitemap and the IndexNow key.
