import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { webCwvConfig } from "../apps/web/web-cwv.config";
import { median } from "../apps/web/src/features/telemetry/lib/vitals-stats";
import { chatDictFor } from "../apps/web/src/features/chat/i18n";
import { solveTurnstileEntry, stubTurnstileEntry } from "./helpers/turnstile";

/* This harness sets no locale, so the app negotiates the browser default
 * (English); the login name comes from the en dictionary, not ja. */
const en = chatDictFor("en");

interface CwvMetrics {
  cls: number;
  lcp: number;
  inp: number;
}

declare global {
  interface Window {
    __cwv?: CwvMetrics;
  }
}

// AC1 — the harness is a fixed cold-start MOBILE profile derived from the
// shared config: viewport, DPR, touch/Android emulation. CPU/network/cache
// throttling is pushed per-run over CDP (applyProfile), and a cold start is
// forced between runs (clearBrowserCache).
test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? new URL(webCwvConfig.url).origin,
  viewport: webCwvConfig.profile.viewport,
  isMobile: webCwvConfig.profile.isMobile,
  hasTouch: webCwvConfig.profile.hasTouch,
  deviceScaleFactor: webCwvConfig.profile.deviceScaleFactor,
});

const reportDir = join(__dirname, "..", "apps", "web", webCwvConfig.reportDir);

/** Browser-side observer sources are strings: addInitScript serializes one
 * function with no closure, so Node helpers (webCwvConfig, Page) can never be
 * reached from the page context. */
const INIT_METRICS_SOURCE = `Object.defineProperty(window, "__cwv", { value: { cls: 0, lcp: 0, inp: 0 } });`;

const CLS_OBSERVER_SOURCE = `new PerformanceObserver((list) => {
  const metrics = window.__cwv;
  for (const entry of list.getEntries()) {
    if (entry.entryType !== "layout-shift" || entry.hadRecentInput) continue;
    metrics.cls += entry.value;
  }
}).observe({ type: "layout-shift", buffered: true });`;

const LCP_OBSERVER_SOURCE = `new PerformanceObserver((list) => {
  const entries = list.getEntries();
  window.__cwv.lcp = entries[entries.length - 1]?.startTime ?? 0;
}).observe({ type: "largest-contentful-paint", buffered: true });`;

// AC2 — INP interaction proxy: the Event Timing observer reports interaction
// duration (processing + presentation) for every real input, which is the
// regression signal the field INP would later carry. buffered reads the past
// as well as future events, so a driven click always lands.
const INP_OBSERVER_SOURCE = `new PerformanceObserver((list) => {
  const metrics = window.__cwv;
  for (const entry of list.getEntries()) {
    const duration = entry.duration;
    if (entry.interactionId > 0 && Number.isFinite(duration) && duration > metrics.inp) {
      metrics.inp = duration;
    }
  }
}).observe({ type: "event", buffered: true, durationThreshold: 0 });`;

const installObservers = async (page: Page): Promise<void> => {
  await page.addInitScript({ content: INIT_METRICS_SOURCE });
  await page.addInitScript({ content: CLS_OBSERVER_SOURCE });
  await page.addInitScript({ content: LCP_OBSERVER_SOURCE });
  await page.addInitScript({ content: INP_OBSERVER_SOURCE });
};

/** Apply the controlled cold-start profile over CDP: CPU throttle, ~3G
 * network, and (per AC1 profile.cache === "none") a cleared browser cache so
 * every run is a true cold start. */
const applyProfile = async (page: Page): Promise<void> => {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", {
    rate: webCwvConfig.profile.cpuThrottleRate,
  });
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: webCwvConfig.profile.network.latency,
    downloadThroughput: webCwvConfig.profile.network.downloadThroughput,
    uploadThroughput: webCwvConfig.profile.network.uploadThroughput,
  });
  await session.send("Network.clearBrowserCache");
  await session.detach();
};

const measureRoute = async (page: Page, route: string): Promise<CwvMetrics> => {
  await page.goto(route, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__cwv?.lcp ?? 0) > 0);
  return page.evaluate(() => ({
    cls: window.__cwv?.cls ?? 0,
    lcp: window.__cwv?.lcp ?? 0,
    inp: window.__cwv?.inp ?? 0,
  }));
};

const measureRun = async (page: Page, route: string): Promise<CwvMetrics> => {
  await applyProfile(page);
  return measureRoute(page, route);
};

/** The report records the measured route, not the bare origin — the route
 * inventory is what the gate is about, so a report saying "/" while the run
 * measured /chat would be the exact drift AC1 exists to prevent. */
const writeRunReport = async (run: number, route: string, metrics: CwvMetrics): Promise<void> => {
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    join(reportDir, `web-cwv-run-${String(run)}.json`),
    JSON.stringify({ run, url: new URL(route, webCwvConfig.url).toString(), ...metrics }, null, 2),
  );
};

const collectRuns = async (page: Page, route: string): Promise<CwvMetrics[]> => {
  const runs: CwvMetrics[] = [];
  for (let run = 1; run <= webCwvConfig.numberOfRuns; run++) {
    const metrics = await measureRun(page, route);
    await writeRunReport(run, route, metrics);
    runs.push(metrics);
  }
  return runs;
};

const assertWithin = (metric: number, limit: number, name: string): void => {
  expect(metric, name).toBeLessThanOrEqual(limit);
};

async function prepareInteraction(page: Page): Promise<void> {
  await stubTurnstileEntry(page);
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
}

// AC1 + AC2 — every controlled cold-start run over the fixed route inventory
// must land LCP and CLS within their BLOCKING thresholds (median of 3 runs).
test(`median LCP and CLS over ${String(webCwvConfig.numberOfRuns)} cold-start runs stay at or below good boundaries`, async ({ page }) => {
  await installObservers(page);
  const route = webCwvConfig.routes[0];
  const runs = await collectRuns(page, route);
  const lcp = median(runs.map((run) => run.lcp)) ?? 0;
  const cls = median(runs.map((run) => run.cls)) ?? 0;
  test.info().annotations.push({ type: "lcp", description: `median LCP ${String(lcp)}ms` });
  assertWithin(lcp, webCwvConfig.thresholds.lcp.error, "median LCP");
  assertWithin(cls, webCwvConfig.thresholds.cls.error, "median CLS");
});

// AC3 — one representative interaction flow on the measured route must produce
// an Interaction-to-Next-Paint proxy well inside the 200ms "good" boundary.
// Same cold-start profile and median aggregation.
test(`a representative mobile interaction drives INP at or below ${String(webCwvConfig.thresholds.inp.error)}ms`, async ({ page }) => {
  await installObservers(page);
  await prepareInteraction(page);
  const route = webCwvConfig.routes[0];
  const inpRuns: number[] = [];
  for (let run = 1; run <= webCwvConfig.numberOfRuns; run++) {
    await applyProfile(page);
    await page.goto(route, { waitUntil: "load" });
    await solveTurnstileEntry(page);
    await page.waitForFunction(() => (window.__cwv?.lcp ?? 0) > 0);
    // Representative interaction on /chat: login opens its existing dialog,
    // a React state update plus a mounted focus trap that stays on the measured
    // document. Settings is now ordinary navigation, whose document load would
    // correctly reset this page-scoped Event Timing observer. The mobile bar
    // carries the login entry on this fixed narrow profile.
    await page.getByRole("button", { name: en.appbar.login }).click();
    await page.waitForFunction(() => (window.__cwv?.inp ?? 0) > 0);
    inpRuns.push(await page.evaluate(() => window.__cwv?.inp ?? 0));
  }
  const inp = median(inpRuns) ?? 0;
  test.info().annotations.push({ type: "inp", description: `median INP ${String(inp)}ms` });
  assertWithin(inp, webCwvConfig.thresholds.inp.error, "median INP");
});
