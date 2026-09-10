/** Native hard cut authorized on 2026-09-10: verify execution and graph boundaries, not validator brand names. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { Miniflare } from "miniflare";
import { bundleLikeWrangler, deployedRuntime } from "./wrangler-bundle.ts";

const directory = mkdtempSync(join(tmpdir(), "edge-entry-bundle-"));
after(() => { rmSync(directory, { recursive: true, force: true }); });
const outfile = join(directory, "entry.js");
const bundle = await bundleLikeWrangler(fileURLToPath(new URL("../src/entry.ts", import.meta.url)), outfile);

void test("the official production entry executes in workerd", async (context) => {
  const worker = new Miniflare({ modulesRoot: directory, modules: [{ type: "ESModule", path: outfile }],
    ...deployedRuntime() });
  context.after(() => worker.dispose());
  const response = await worker.dispatchFetch("https://native.test/not-a-route");
  assert.equal(response.status, 404);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "not_found");
  context.diagnostic(JSON.stringify({ bytes: Buffer.byteLength(bundle.code), gzipBytes: gzipSync(bundle.code).byteLength }));
});

void test("the deployed entry includes the shared native agent tools and direct Prisma storage", () => {
  const inputs = Object.keys(bundle.metafile.inputs).join("\n");
  assert.match(inputs, /packages\/agent\/src\/harness.ts/);
  assert.match(inputs, /packages\/pi-session-neon\/src\/repo.ts/);
});

void test("bundlers, eval and conformance implementations stay outside the Worker", () => {
  const inputs = Object.keys(bundle.metafile.inputs).join("\n");
  assert.doesNotMatch(inputs, /node_modules\/esbuild\/|packages\/eval\/|packages\/test-postgres\/|harness\/session\/testing|edge\/api-test\//);
  assert.doesNotMatch(bundle.code, /esbuild\/lib\/main\.js|esbuild version/);
});
