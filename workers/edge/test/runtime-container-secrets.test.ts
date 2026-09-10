import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { build } from "esbuild";
import type { RuntimeContainer } from "../src/entry.ts";

const output = mkdtempSync(join(tmpdir(), "runtime-container-secrets-"));
const bundle = join(output, "entry.mjs");
after(() => { rmSync(output, { recursive: true, force: true }); });
await build({
  entryPoints: [fileURLToPath(new URL("../src/entry.ts", import.meta.url))],
  outfile: bundle, bundle: true, platform: "node", format: "esm",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  alias: {
    "@cloudflare/containers": fileURLToPath(new URL("./doubles/container-start-boundary.ts", import.meta.url)),
    "cloudflare:workers": fileURLToPath(new URL("./doubles/cloudflare-runtime-stubs.ts", import.meta.url)),
    "cloudflare:email": fileURLToPath(new URL("./doubles/cloudflare-runtime-stubs.ts", import.meta.url)),
  },
});
const entry = await import(pathToFileURL(bundle).href) as { RuntimeContainer: typeof RuntimeContainer };

function container(env: Record<string, unknown>) {
  return new entry.RuntimeContainer({} as DurableObjectState<object>, env) as RuntimeContainer & {
    starts: Record<string, string>[];
  };
}

const LOCAL_ENV = {
  DEEPSEEK_API_KEY: "local-deepseek", MIMO_API_KEY: "local-mimo",
  APP_ENV: "development",
};

void test("container construction accepts native bindings and start receives resolved secrets", async () => {
  const runtime = container({ ...LOCAL_ENV, MIMO_API_KEY: { get: () => Promise.resolve("store-mimo") } });
  await runtime.start();
  assert.equal(runtime.starts[0]?.MIMO_API_KEY, "store-mimo");
});

void test("each container start reads a rotated store value instead of retaining the first value", async () => {
  let value = "initial-mimo";
  const runtime = container({ ...LOCAL_ENV, MIMO_API_KEY: { get: () => Promise.resolve(value) } });
  await runtime.start();
  value = "rotated-mimo";
  await runtime.startAndWaitForPorts();
  assert.deepEqual(runtime.starts.map((env) => env.MIMO_API_KEY), ["initial-mimo", "rotated-mimo"]);
});

void test("a failed store read prevents starting a process with stale credentials", async () => {
  const runtime = container({ ...LOCAL_ENV, MIMO_API_KEY: { get: () => Promise.reject(new Error("store unavailable")) } });
  await assert.rejects(runtime.start(), /store unavailable/);
  assert.deepEqual(runtime.starts, []);
});

void test("container startup uses the role DSN without a retired database credential", async () => {
  const runtime = container({
    DEEPSEEK_API_KEY: "local-deepseek", MIMO_API_KEY: "local-mimo", APP_ENV: "development",
    AGENT_SVC_DATABASE_URL: { get: () => Promise.resolve("postgresql://agent_svc@local/test") },
  });
  await runtime.start();
  assert.equal(runtime.starts[0]?.AGENT_SVC_DATABASE_URL, "postgresql://agent_svc@local/test");
  assert.equal(Object.hasOwn(runtime.starts[0], "SUPABASE_DB_URL"), false);
});
