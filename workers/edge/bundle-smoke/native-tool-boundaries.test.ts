import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { bundleLikeWrangler, deployedRuntime } from "./wrangler-bundle.ts";

void test("native production tools reject malformed invocation input and successful-but-invalid catalog output in workerd", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "native-tool-boundaries-"));
  const outfile = join(directory, "worker.js");
  await bundleLikeWrangler(new URL("./native-tool-boundaries.worker.ts", import.meta.url).pathname, outfile);
  const worker = new Miniflare({ modulesRoot: directory, modules: [{ type: "ESModule", path: outfile }], ...deployedRuntime() });
  context.after(async () => { await worker.dispose(); await rm(directory, { recursive: true, force: true }); });
  const invalidInput = await worker.dispatchFetch("https://native.test/invalid-input");
  assert.equal(invalidInput.status, 200);
  const inputResult = await invalidInput.json() as { rejected: boolean; calls: number; diagnostic: unknown };
  assert.equal(inputResult.rejected, true);
  assert.equal(inputResult.calls, 0);
  const invalidOutput = await worker.dispatchFetch("https://native.test/invalid-output");
  assert.equal(invalidOutput.status, 200);
  const outputResult = await invalidOutput.json() as { rejected: boolean; calls: number; diagnostic: unknown };
  assert.equal(outputResult.rejected, true);
  assert.equal(outputResult.calls, 1, JSON.stringify(outputResult.diagnostic));
});
