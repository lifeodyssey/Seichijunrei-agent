import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Container } from "@cloudflare/containers";
import {
  CONTAINER_ENV_KEYS,
  CONTAINER_REQUIRED_KEYS,
  buildContainerEnvVars,
  resolveContainerEnvVars,
} from "../src/container/container-env.ts";
import {
  CONTAINER_PORT_READY_TIMEOUT_MS,
  withPortReadyBudget,
} from "../src/container/port-ready-budget.ts";
import { CONTAINER_FETCH_HEAD_TIMEOUT_MS } from "../src/gateway/container-fetch.ts";

type StartAndWaitForPortsArgs = Parameters<Container["startAndWaitForPorts"]>;
type PortsOrOptions = NonNullable<StartAndWaitForPortsArgs[0]>;
type OptionsObject = Exclude<PortsOrOptions, number | number[]>;

function requiredEnv(): Record<string, string> {
  return { DEEPSEEK_API_KEY: "k", MIMO_API_KEY: "k", SUPABASE_DB_URL: "postgres://x", APP_ENV: "development" };
}

void test("ANON_DAILY_MESSAGE_QUOTA reaches the container (issue #282) — wrangler.toml alone is not the whole contract", () => {
  const envVars = buildContainerEnvVars({ ...requiredEnv(), ANON_DAILY_MESSAGE_QUOTA: "20" });
  assert.equal(envVars.ANON_DAILY_MESSAGE_QUOTA, "20");
});

void test("an unset ANON_DAILY_MESSAGE_QUOTA is simply absent, not forwarded as an empty string", () => {
  const envVars = buildContainerEnvVars(requiredEnv());
  assert.equal("ANON_DAILY_MESSAGE_QUOTA" in envVars, false);
});

void test("photo-search quota settings reach the container", () => {
  const envVars = buildContainerEnvVars({
    ...requiredEnv(),
    PHOTO_SEARCH_QUOTA_ANON: "3",
    PHOTO_SEARCH_QUOTA_MEMBER: "8",
  });
  assert.equal(envVars.PHOTO_SEARCH_QUOTA_ANON, "3");
  assert.equal(envVars.PHOTO_SEARCH_QUOTA_MEMBER, "8");
});

// #284 Task 7 (PR #478 review): `entry.ts` imports `Container` from
// `@cloudflare/containers`, whose ESM build only resolves under workerd's
// module loader (see `containerEnv.ts`'s header comment) — so this cannot be a
// plain `import` + runtime-shape assertion under `node --test`. A source-text
// check is the closest thing to a regression guard we can run outside
// wrangler/workerd: `applyOutboundInterception` hard-throws at container start
// when `ctx.exports.ContainerProxy` is undefined, so losing this export line
// would silently make `deniedHosts` (and any outbound interception) inert.
void test("entry.ts re-exports ContainerProxy from @cloudflare/containers", () => {
  const entrySource = readFileSync(new URL("../src/entry.ts", import.meta.url).pathname, "utf8");
  assert.match(entrySource, /export\s*\{\s*ContainerProxy\s*\}\s*from\s*["']@cloudflare\/containers["']/);
});

// Issue #1220: sleepAfter was previously unset, relying on
// @cloudflare/containers' own default. This pins it explicitly so an
// upstream default change can't silently retune the container's idle-sleep
// window — see entry.ts's RuntimeContainer for the library-default citation.
void test("RuntimeContainer pins an explicit sleepAfter (#1220)", () => {
  const entrySource = readFileSync(new URL("../src/entry.ts", import.meta.url).pathname, "utf8");
  assert.match(entrySource, /sleepAfter\s*=\s*["']10m["']/);
});

void test("entry.ts hydrates Secrets Store env before container start (#1157)", () => {
  const entrySource = readFileSync(new URL("../src/entry.ts", import.meta.url).pathname, "utf8");
  assert.match(entrySource, /resolveContainerEnvVars/);
  assert.match(entrySource, /override async start\(/);
  assert.match(entrySource, /override async startAndWaitForPorts\(/);
});

void test("resolveContainerEnvVars omits absent AGENT_SVC_DATABASE_URL (#1157)", async () => {
  const environmentVars = await resolveContainerEnvVars(requiredEnv());
  assert.equal("AGENT_SVC_DATABASE_URL" in environmentVars, false);
});

void test("resolveContainerEnvVars omits an empty store AGENT_SVC_DATABASE_URL (#1157)", async () => {
  const environmentVars = await resolveContainerEnvVars({
    ...requiredEnv(),
    AGENT_SVC_DATABASE_URL: { get: () => Promise.resolve("") },
  });
  assert.equal("AGENT_SVC_DATABASE_URL" in environmentVars, false);
});

void test("ZEN_GO_API_KEY is forwarded to the container when set (#1160)", () => {
  const environmentVars = buildContainerEnvVars({ ...requiredEnv(), ZEN_GO_API_KEY: "zen-key" });
  assert.equal(environmentVars.ZEN_GO_API_KEY, "zen-key");
});

void test("ZEN_GO_API_KEY is optional on the Worker: absent stays omitted, never required", () => {
  assert.equal(CONTAINER_ENV_KEYS.includes("ZEN_GO_API_KEY"), true);
  assert.equal(CONTAINER_REQUIRED_KEYS.includes("ZEN_GO_API_KEY"), false);
  assert.equal("ZEN_GO_API_KEY" in buildContainerEnvVars(requiredEnv()), false);
});

// Issue #1220 follow-up (2026-09-01 staging reproduction): the library's
// default port-ready wait (20s) is shorter than the container's measured
// cold start (>35s), so the first request after the idle window got a 500
// before the app finished starting. `withPortReadyBudget` widens that wait
// without touching the caller's other cancellation options.
void test("withPortReadyBudget merges the budget into a positional cancellationOptions, keeping abort", () => {
  const abort = new AbortController().signal;
  const [, cancellationOptions] = withPortReadyBudget([8080, { abort }]);
  const gotAbort = cancellationOptions?.abort;
  const gotBudget = cancellationOptions?.portReadyTimeoutMS;
  assert.equal(gotAbort, abort);
  assert.equal(gotBudget, CONTAINER_PORT_READY_TIMEOUT_MS);
});

void test("withPortReadyBudget fills in the budget when no cancellationOptions is given", () => {
  const [, cancellationOptions] = withPortReadyBudget([8080]);
  assert.equal(cancellationOptions?.portReadyTimeoutMS, CONTAINER_PORT_READY_TIMEOUT_MS);
});

void test("withPortReadyBudget merges the budget into the object call shape", () => {
  const abort = new AbortController().signal;
  const [merged] = withPortReadyBudget([{ ports: 8080, cancellationOptions: { abort } }]);
  const options = merged as OptionsObject;
  const gotAbort = options.cancellationOptions?.abort;
  const gotBudget = options.cancellationOptions?.portReadyTimeoutMS;
  assert.equal(gotAbort, abort);
  assert.equal(gotBudget, CONTAINER_PORT_READY_TIMEOUT_MS);
});

void test("withPortReadyBudget preserves an explicit caller portReadyTimeoutMS", () => {
  const [, cancellationOptions] = withPortReadyBudget([8080, { portReadyTimeoutMS: 1234 }]);
  assert.equal(cancellationOptions?.portReadyTimeoutMS, 1234);
});

void test("CONTAINER_PORT_READY_TIMEOUT_MS is pinned to 55s and stays under the head timeout (#1220)", () => {
  assert.equal(CONTAINER_PORT_READY_TIMEOUT_MS, 55_000);
  const portReadyMs: number = CONTAINER_PORT_READY_TIMEOUT_MS;
  assert.ok(portReadyMs < CONTAINER_FETCH_HEAD_TIMEOUT_MS);
});

void test("entry.ts routes startAndWaitForPorts through the port-ready budget (#1220)", () => {
  const entrySource = readFileSync(new URL("../src/entry.ts", import.meta.url).pathname, "utf8");
  assert.match(entrySource, /withPortReadyBudget\(args\)/);
});
