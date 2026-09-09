import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { bundleLikeWrangler } from "./wrangler-bundle.ts";

const EXPECTED = {
  city: "宇治",
  selection: "Created a route with 2 selected stops.",
  status: "result Uji",
  address: { host: "169.254.169.254", kind: "metadata" },
};

async function bundledConsumer(context: TestContext): Promise<Miniflare> {
  const directory = await mkdtemp(join(tmpdir(), "agent-domain-bundle-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const scriptPath = join(directory, "worker.js");
  await bundleLikeWrangler(fileURLToPath(new URL("./agent-domain.worker.ts", import.meta.url)), scriptPath);
  const worker = new Miniflare({ modules: true, scriptPath, modulesRoot: directory, compatibilityDate: "2026-07-01" });
  context.after(() => worker.dispose());
  return worker;
}

void test("the public agent package executes inside a real workerd consumer", async (context) => {
  const worker = await bundledConsumer(context);
  const response = await worker.dispatchFetch("http://agent-domain.local/");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), EXPECTED);
});
