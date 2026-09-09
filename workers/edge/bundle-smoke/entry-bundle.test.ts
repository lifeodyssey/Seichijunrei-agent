/**
 * What the deployed Worker bundle is allowed to contain (issue #1285).
 *
 * The agent tier keeps zod out of `src/` by construction — the schema seam is
 * `packages/contract/scripts/emit-tool-schemas.ts` and the generated module it
 * writes, and every other contract module the Worker reads at runtime is
 * import-free. That property is invisible to `tsc`, to oxlint and to the
 * node:test suite: all three see unbundled source, where a zod-carrying module
 * costs nothing. It is only visible in the artifact — a single value import
 * from a zod module pulls all 79 of zod's files into every isolate the edge
 * starts, for a route table of fourteen strings.
 *
 * So this gate builds `src/entry.ts` the way the deploy path builds it and
 * reads the result. Two assertions, on purpose: the module graph is the
 * structural fact (and names the importer when it regresses), while the
 * `ZodError` marker is what a reviewer can grep the shipped file for.
 *
 * Mutation proof (recorded on the card): put the pre-#1285 world back — re-add
 * `export { AGENT_PATHS } from "./agent-paths.js"` to the contract's
 * `agent-contract.ts`, then point `src/gateway/routing-policy.ts` (or
 * `rate-policy.ts`, which imports the same table) at it — and both assertions
 * fail, the first naming `agent-contract.ts` as the importer. Flipping the
 * import alone no longer builds: the zod modules deliberately re-export
 * neither constant, which is a second and coarser guard, not this one.
 *
 * test-type: unit (hermetic — no network, no clock; esbuild over the tree).
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { bundleLikeWrangler } from "./wrangler-bundle.ts";

const OUT_DIR = mkdtempSync(join(tmpdir(), "edge-entry-bundle-"));

after(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
});

const ENTRY = fileURLToPath(new URL("../src/entry.ts", import.meta.url));
const bundle = await bundleLikeWrangler(ENTRY, join(OUT_DIR, "entry.js"));

/** Every file esbuild pulled in from the zod package, deploy-relative. */
function zodInputs(): string[] {
  return Object.keys(bundle.metafile.inputs).filter((input) => /(^|\/)node_modules\/zod\//.test(input));
}

/** Which of OUR modules imported one of them — the line to delete. */
function zodImporters(): string[] {
  const importers = Object.entries(bundle.metafile.inputs)
    .filter(([input]) => !input.includes("node_modules"))
    .filter(([, meta]) => meta.imports.some((edge) => /(^|\/)node_modules\/zod\//.test(edge.path)))
    .map(([input]) => input);
  return [...new Set(importers)];
}

void test("the deployed entry bundle pulls in no zod module", () => {
  assert.deepEqual(
    zodInputs(),
    [],
    `zod reached the Worker bundle through ${zodImporters().join(", ") || "an unknown import"} — read the contract constant off an import-free module instead`,
  );
});

void test("the shipped entry artifact carries no zod marker", () => {
  assert.equal(bundle.code.split("ZodError").length - 1, 0, "the built entry bundle still contains zod's ZodError");
});

void test("the deployed entry includes the shared agent domain package", () => {
  assert.ok(Object.keys(bundle.metafile.inputs).some((input) => input.includes("packages/agent/src/")));
});

void test("Node-only evaluation and SDK conformance fixtures stay outside the Worker", () => {
  const inputs = Object.keys(bundle.metafile.inputs).join("\n");
  assert.doesNotMatch(inputs, /packages\/eval\/|packages\/test-postgres\/|harness\/session\/testing|edge\/api-test\//);
});
