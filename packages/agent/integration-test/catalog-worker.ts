import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import { parse } from "smol-toml";

export async function catalogWorker(context: TestContext, connectionString: string, endpoint: string) {
  const directory = await mkdtemp(join(tmpdir(), "native-catalog-tools-"));
  const config = await catalogConfig(directory, connectionString, endpoint);
  const wrangler = join(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin/wrangler.js");
  const worker = spawn(process.execPath, [wrangler, "dev", "--local", "--port", "0", "--inspector-port", "0", "--latest=false",
    "--show-interactive-dev-session=false", "--config", config], { stdio: ["ignore", "pipe", "pipe"], signal: context.signal,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(directory, "build.log") } });
  const exited = once(worker, "exit"); void exited.catch(() => undefined);
  let errors = ""; worker.stderr.on("data", (data: Buffer) => { errors += data.toString(); });
  context.after(async () => {
    worker.kill(); await exited; await rm(directory, { recursive: true, force: true });
  });
  for await (const line of createInterface({ input: worker.stdout })) {
    const address = /Ready on (http:\/\/\S+)/.exec(line)?.[1];
    if (address) return new URL(address);
  }
  throw new Error(`Catalog Worker exited before readiness: ${errors}`);
}

async function catalogConfig(directory: string, connectionString: string, endpoint: string) {
  const config = parse(await readFile(new URL("../../../workers/catalog/wrangler.toml", import.meta.url), "utf8"));
  assert.equal(typeof config.compatibility_date, "string"); assert.ok(Array.isArray(config.compatibility_flags));
  const path = join(directory, "wrangler.json");
  await writeFile(path, JSON.stringify({ name: "native-catalog-tools", main: fileURLToPath(new URL("./worker/catalog.worker.ts", import.meta.url)),
    compatibility_date: config.compatibility_date, compatibility_flags: config.compatibility_flags,
    vars: { DATABASE_URL: connectionString, TEST_FETCH_ENDPOINT: endpoint, ENVIRONMENT: "development" } }));
  return path;
}
