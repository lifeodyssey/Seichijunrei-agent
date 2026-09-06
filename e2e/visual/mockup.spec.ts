/**
 * Visual mockup comparison pipeline (S0-v2 C3) — the @visual spec.
 *
 * Per frame (see frames.ts) three tiers run:
 *  1. canonical shot  — render the frozen canonical mockup from a local
 *                       server (no network fonts, no scripts, no dev chrome),
 *                       screenshot into canonical-shots/.
 *  2. convergence     — screenshot the real app route at the same viewport,
 *                       pixelmatch against the canonical shot, write a diff
 *                       heatmap + machine-readable JSON summary (ratio +
 *                       diff-cluster bounding boxes) into report/, assert
 *                       ratio ≤ VISUAL_RATIO.
 *  3. regression      — the app against its own accepted baseline snapshot
 *                       (toHaveScreenshot, maxDiffPixelRatio = VISUAL_RATIO).
 *
 * Opt-in via `make visual-check` (VISUAL_CHECK=1); the plain e2e suite must
 * stay untouched, so without the flag everything here is skipped.
 */

import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { clusterBoxes, diffPixels, type DiffCluster } from "./diff";
import { resolveFrame } from "./frames";
import { decodePng, encodePng, type PngImage } from "./png";
import { startVisualServer, type VisualServer } from "./server";

const VISUAL_DIR = __dirname;
const CANONICAL_DIR = path.join(VISUAL_DIR, "canonical");
const FONTS_DIR = path.resolve(VISUAL_DIR, "../../apps/web/public/fonts");
const SHOTS_DIR = path.join(VISUAL_DIR, "canonical-shots");
const APP_SHOTS_DIR = path.join(VISUAL_DIR, "app-shots");
const REPORT_DIR = path.join(VISUAL_DIR, "report");

const VISUAL_CHECK = process.env.VISUAL_CHECK === "1";
const VISUAL_RATIO = Number.parseFloat(process.env.VISUAL_RATIO ?? "0.01");
const APP_BASE_URL = process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000";
const PAGE = process.env.VISUAL_PAGE ?? "landing";
const MODE = process.env.VISUAL_MODE ?? "day";
const frame = resolveFrame(PAGE, MODE);

interface CompareReport {
  frame: string;
  width: number;
  height: number;
  ratio: number;
  threshold: number;
  pass: boolean;
  clusters: DiffCluster[];
  canonicalShot: string;
  appShot: string;
  diffImage: string;
}

async function probeApp(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function captureCanonical(page: Page, server: VisualServer, canonicalName: string, outPath: string): Promise<void> {
  await page.goto(server.url(`/${canonicalName}`), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("body")).toBeVisible();
  await mkdir(path.dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, animations: "disabled", caret: "hide" });
}

/**
 * Night mode is paused (2026-09): the app no longer honors a stored
 * "animichi-theme=night", so the rig forces the attribute directly. The night
 * tokens stay in the stylesheet, which keeps night frames shootable for when
 * the palette work resumes.
 */
async function forceNightTheme(page: Page, night: boolean): Promise<void> {
  if (!night) return;
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "night";
  });
}

async function gotoApp(page: Page, night: boolean, route: string): Promise<void> {
  await page.goto(`${APP_BASE_URL}${route}`, { waitUntil: "load" });
  await forceNightTheme(page, night);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-splash="static"]')).toBeHidden({ timeout: 10_000 });
  await expect(page.locator("main.landing").first()).toBeVisible();
}

async function writeReport(frameKey: string, canonical: PngImage, app: PngImage, threshold: number): Promise<CompareReport> {
  if (canonical.width !== app.width || canonical.height !== app.height) {
    throw new Error(
      `visual: size mismatch canonical ${String(canonical.width)}x${String(canonical.height)} vs app ${String(app.width)}x${String(app.height)}`,
    );
  }
  const result = diffPixels(canonical.rgba, app.rgba);
  const clusters = clusterBoxes(result.diff, app.width, app.height);
  const report: CompareReport = {
    frame: frameKey,
    width: app.width,
    height: app.height,
    ratio: result.ratio,
    threshold,
    pass: result.ratio <= threshold,
    clusters: clusters.slice(0, 20),
    canonicalShot: `canonical-shots/${frameKey}.png`,
    appShot: `app-shots/${frameKey}.png`,
    diffImage: `report/${frameKey}.diff.png`,
  };
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(path.join(REPORT_DIR, `${frameKey}.diff.png`), encodePng({ width: app.width, height: app.height, rgba: result.diff }));
  await writeFile(path.join(REPORT_DIR, `${frameKey}.json`), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function ensureCanonicalShot(page: Page, server: VisualServer, shotPath: string): Promise<void> {
  if (existsSync(shotPath)) return;
  await captureCanonical(page, server, frame.canonicalName, shotPath);
}

async function captureAppShot(page: Page): Promise<Buffer> {
  const shot = await page.screenshot({ animations: "disabled", caret: "hide" });
  await mkdir(APP_SHOTS_DIR, { recursive: true });
  await writeFile(path.join(APP_SHOTS_DIR, `${frame.key}.png`), shot);
  return shot;
}

function clusterSummary(report: CompareReport): string {
  return report.clusters
    .slice(0, 5)
    .map((cluster) => `${String(cluster.width)}x${String(cluster.height)}@(${String(cluster.x)},${String(cluster.y)})`)
    .join(" ");
}

async function expectAppConvergence(page: Page, server: VisualServer): Promise<void> {
  const canonicalPath = path.join(SHOTS_DIR, `${frame.key}.png`);
  await ensureCanonicalShot(page, server, canonicalPath);
  await gotoApp(page, frame.mode === "night", frame.route);
  const appShot = await captureAppShot(page);
  const report = await writeReport(frame.key, decodePng(await readFile(canonicalPath)), decodePng(appShot), VISUAL_RATIO);
  const message = `ratio ${report.ratio.toFixed(4)} > ${String(VISUAL_RATIO)}; top clusters: ${clusterSummary(report)}`;
  expect(report.pass, message).toBe(true);
}

test.describe("visual mockup pipeline", () => {
  test.skip(!VISUAL_CHECK, "visual suite is opt-in — run `make visual-check`");

  let appReachable = false;

  test.beforeAll(async () => {
    appReachable = await probeApp(APP_BASE_URL);
  });

  test.describe(`frame ${frame.key} (${String(frame.viewport.width)}x${String(frame.viewport.height)}, ${frame.mode})`, () => {
    let server: VisualServer;

    test.beforeAll(async () => {
      server = await startVisualServer([
        { prefix: "/", root: CANONICAL_DIR },
        { prefix: "/fonts", root: FONTS_DIR },
      ]);
    });

    test.afterAll(async () => {
      await server.close();
    });

    test.use({
      viewport: frame.viewport,
      colorScheme: frame.mode === "night" ? "dark" : "light",
    });

    test("canonical shot renders the frozen mockup", { tag: "@visual" }, async ({ page }) => {
      const shotPath = path.join(SHOTS_DIR, `${frame.key}.png`);
      await captureCanonical(page, server, frame.canonicalName, shotPath);
      await expect(page).toHaveTitle(/聖地巡礼/);
    });

    test("app route converges on the canonical shot", { tag: "@visual" }, async ({ page }) => {
      test.skip(!appReachable, `app not reachable at ${APP_BASE_URL} — start \`make dev-local\``);
      await expectAppConvergence(page, server);
    });

    test("app matches its accepted regression baseline", { tag: "@visual" }, async ({ page }) => {
      test.skip(!appReachable, `app not reachable at ${APP_BASE_URL} — start \`make dev-local\``);
      await gotoApp(page, frame.mode === "night", frame.route);
      await expect(page).toHaveScreenshot(`${frame.key}.png`, {
        maxDiffPixelRatio: VISUAL_RATIO,
        animations: "disabled",
        caret: "hide",
      });
    });
  });
});
