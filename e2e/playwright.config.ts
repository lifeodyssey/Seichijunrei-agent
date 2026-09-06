import { defineConfig } from "@playwright/test";

// Staging credentials are written to a host-scoped cookie by global setup so
// browser requests to third-party origins never receive the gate token.
const stagingGateToken = process.env.STAGING_GATE_TOKEN;

// The Playwright MCP test server (the agent tool surface) runs as
// `npx playwright run-test-mcp-server`; every other invocation is the plain
// test runner. The "seed" project exists only in the MCP server process so the
// agents can resolve seed.spec.ts while default CLI runs stay at 113 cases in
// 21 files — 81 in 18 for `chromium`, 32 in 3 for `visual`, seed in neither
// (`playwright test --list`, 2026-09-05; see generated/README.md).
//
// Worker processes re-require this config file with a different argv, so the
// detection is propagated through the environment: the controller (whose argv
// carries the flag) sets it, and workers inherit process.env at fork time.
const isMcpTestServer = process.argv.slice(2).includes("run-test-mcp-server");
if (isMcpTestServer)
  process.env.E2E_SEED_PROJECT = "1";
const seedProjectEnabled = isMcpTestServer || process.env.E2E_SEED_PROJECT === "1";

// The emitted-Worker lane (card B4 / #1362): `pnpm test` — the CI `e2e` job —
// is the one invocation that owns its server. It builds `apps/web` and serves
// the emitted Worker through `wrangler dev` from here, which is what the
// retired `.github/actions/cross-stack-e2e` composite spelled out as a build
// step, a background `wrangler dev` and a curl readiness loop. Every other
// invocation targets an app someone else started (`make dev-local` on :3000,
// staging through E2E_WEB_BASE_URL), so the server is opt-in.
const emittedWorkerPort = "8799";
const emittedWorkerOrigin = `http://localhost:${emittedWorkerPort}`;
const servesEmittedWorker = process.env.E2E_SERVE_EMITTED_WORKER === "1";
// Cloudflare's always-passing test site key, and an unroutable stand-in for
// the agent and Neon Auth origins: the specs stub every transport with
// `page.route`, so the lane needs the shapes, not reachable services.
const turnstileTestSiteKey = "1x00000000000000000000AA";
const unroutableOrigin = "http://127.0.0.1:9";
// The SSR `RUNTIME_CONFIG` var apps/web parses per request
// (apps/web/src/lib/runtime-config/provider.ts). Public placeholder values
// only; `wrangler dev --var KEY:VALUE` keeps everything after the first colon
// (wrangler 4.114 `collectKeyValues`), so the JSON survives intact.
const emittedWorkerRuntimeConfig = JSON.stringify({
  schemaVersion: 1,
  api: { agentUrl: "http://127.0.0.1:9001", siteOrigin: emittedWorkerOrigin },
  neonAuthBaseUrl: unroutableOrigin,
  turnstileSiteKey: turnstileTestSiteKey,
  showcaseMode: "false",
  featureFlags: {},
});
// Each spec resolves its own `test.use` base from E2E_WEB_BASE_URL, so the
// lane that starts the server is also the one that names it. Same propagation
// as E2E_SEED_PROJECT above: workers inherit the environment at fork time.
if (servesEmittedWorker)
  process.env.E2E_WEB_BASE_URL = emittedWorkerOrigin;

export default defineConfig({
  globalSetup: "./global-setup.ts",
  testDir: ".",
  testMatch: "*.spec.ts",
  // Agent-discovered specs live in working dirs until human-gated promotion
  // (see generated/README.md + agent-discovered/README.md); the testMatch glob
  // above swallows subdirectories, so exclude them explicitly. The visual suite
  // lives under visual/ and only the @visual project collects it.
  testIgnore: ["generated/**", "agent-discovered/**"],
  timeout: 30_000,
  retries: 0,
  // Playwright defaults to the `dot` reporter whenever CI is set: one
  // character per test, names printed for failures only. The browser lane's
  // acceptance is that the run log shows each spec, so CI gets `list`. The
  // `github` reporter is not the alternative it looks like — its
  // `printsToStdio()` is false and it emits annotations for failures, slow
  // tests and the summary only (playwright 1.62, lib/runner/index.js).
  reporter: process.env.CI ? "list" : undefined,
  // `wrangler dev` serves `.output`, so the build has to precede it inside the
  // same command; the readiness probe on `url` replaces the composite's curl
  // loop and its timeout has to cover a cold Vite build, not just a boot.
  ...(servesEmittedWorker
    ? {
        webServer: {
          command:
            `pnpm --filter web run build && pnpm --filter web exec wrangler dev ` +
            `--port ${emittedWorkerPort} --var 'RUNTIME_CONFIG:${emittedWorkerRuntimeConfig}'`,
          url: emittedWorkerOrigin,
          timeout: 300_000,
          env: {
            VITE_TURNSTILE_SITE_KEY: turnstileTestSiteKey,
            VITE_SHOWCASE_MODE: "false",
            VITE_NEON_AUTH_BASE_URL: unroutableOrigin,
          },
        },
      }
    : {}),
  use: {
    // Issue #537 retired the legacy Next.js frontend, so `apps/web` is the only
    // browser surface left. Specs still set their own `E2E_WEB_BASE_URL` base
    // (see web-404.spec.ts); this is the shared default they agree with.
    // Empty-string exports must fall back too — and the type-aware lint
    // forbids bare `||` on possibly-undefined values, so the empty check is
    // spelled out (issue #1236 review).
    baseURL: process.env.E2E_WEB_BASE_URL?.trim()
      ? process.env.E2E_WEB_BASE_URL
      : "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    ...(stagingGateToken ? { storageState: "./.auth/staging-gate.json" } : {}),
  },
  projects: [
    // seed.spec.ts is a zero-assertion scaffold the generator agents seed from
    // (see generated/README.md). It must stay at the e2e/ root — the Playwright
    // MCP test server (npx playwright run-test-mcp-server) locates seeds there —
    // but it must never count as a case in the always-run suite: a silent
    // 113 -> 114 drift is exactly what the promotion gate exists to prevent.
    //
    // Playwright runs every project in the config by default, so the seed gets
    // its own project that exists ONLY in the MCP server process. The CLI test
    // runner therefore collects nothing but the 113 real cases in 21 files,
    // while the agents' server resolves the seed project (it sits first, and
    // the MCP server seeds from the first top-level project).
    ...(seedProjectEnabled
      ? [
          {
            name: "seed",
            testMatch: "seed.spec.ts",
            use: { browserName: "chromium" as const },
          },
        ]
      : []),
    {
      name: "chromium",
      // seed.spec.ts lives here but is not a test; exclude it from the
      // always-run project (the MCP server uses the "seed" project for it).
      // The visual suite belongs to its own project. A project-level
      // testIgnore replaces (does not merge with) the top-level one, so this
      // must carry the full union — dropping any entry here would let that
      // directory back into the default run.
      testIgnore: ["generated/**", "agent-discovered/**", "visual/**", "seed.spec.ts"],
      use: { browserName: "chromium" },
    },
    {
      name: "visual",
      testDir: "visual",
      testMatch: "*.spec.ts",
      timeout: 60_000,
      use: {
        browserName: "chromium",
        // Determinism: kill CSS animations, no service workers, light scheme
        // unless a frame asks for night (see visual/mockup.spec.ts).
        contextOptions: { reducedMotion: "reduce" },
        serviceWorkers: "block",
        colorScheme: "light",
      },
      // Regression-tier baselines; platform-suffixed so docker (linux) and
      // host (darwin) renders never corrupt each other's accepted state.
      snapshotDir: "./visual/regression-baselines",
      snapshotPathTemplate: "{snapshotDir}/{arg}-{platform}{ext}",
    },
  ],
});
