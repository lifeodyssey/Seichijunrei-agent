// S1 (#1537): execute the exact Wrangler artifact, including the public harness constructor.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { URL, fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createTestHarness } from "wrangler";
import { parse } from "smol-toml";
import type { Metafile } from "esbuild";

interface SmokeConfig {
  name: string;
  compatibility_date: string;
  compatibility_flags: string[];
}

const configPath = fileURLToPath(new URL("./pi-harness.wrangler.json", import.meta.url));
const config = JSON.parse(readFileSync(configPath, "utf8")) as SmokeConfig;
const edge = parse(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"));
const output = mkdtempSync(join(tmpdir(), "pi-harness-smoke-"));

after(() => {
  rmSync(output, { recursive: true, force: true });
});

const { stdout } = await promisify(execFile)("pnpm", ["exec", "wrangler", "deploy", "--dry-run",
  "--config", configPath, "--outdir", output, "--metafile", join(output, "metafile.json")]);
const bundle = join(output, "pi-harness.worker.js");
const code = readFileSync(bundle, "utf8");
const metadata = JSON.parse(readFileSync(join(output, "metafile.json"), "utf8")) as Metafile;

void test("the spike imports the exact published harness and chord 0.85.1 packages", () => {
  const core = readFileSync(fileURLToPath(import.meta.resolve("pi-agent-core-smoke/package.json")), "utf8");
  const chord = readFileSync(fileURLToPath(import.meta.resolve("@earendil-works/chord/package.json")), "utf8");
  assert.match(core, /"version":\s*"0\.85\.1"/);
  assert.match(chord, /"version":\s*"0\.85\.1"/);
});

void test("the pi harness uses the deployed edge compatibility settings", () => {
  assert.equal(config.compatibility_date, edge.compatibility_date);
  assert.deepEqual(config.compatibility_flags, edge.compatibility_flags);
});

void test("the Wrangler artifact includes chord and excludes esbuild", (context) => {
  context.diagnostic(stdout);
  assert.ok(Object.keys(metadata.inputs).some((path) => path.includes("/@earendil-works/chord/dist/")));
  assert.deepEqual(Object.keys(metadata.inputs).filter((path) => path.includes("/esbuild/")), []);
  assert.doesNotMatch(code, /esbuild/i);
});

function artifactServer() {
  return createTestHarness({ workers: [{ config: {
    name: config.name, main: bundle, no_bundle: true,
    compatibility_date: config.compatibility_date, compatibility_flags: config.compatibility_flags,
  } }] });
}

void test("the built 0.85.1 artifact creates and inspects its harness in workerd", async (context) => {
  const server = artifactServer();
  context.after(() => server.close());
  await server.listen();
  const response = await server.fetch("/");
  const body = await response.text();
  assert.equal(response.status, 200, body);
  assert.deepEqual(JSON.parse(body), { open: [], lanes: [] });
});
