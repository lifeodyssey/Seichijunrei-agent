import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareMigrations } from "../../scripts/prepare-migrations";

const WORKER_ROOT = fileURLToPath(new URL("../../", import.meta.url).href);

export async function buildPrismaWorker(directory: string): Promise<void> {
  await promisify(execFile)("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--env=", "--containers-rollout=none", "--outdir", directory], {
    cwd: WORKER_ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(directory, "build.log") },
  });
  await prepareMigrations(directory);
}

export async function nativeModules(directory: string) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const paths = entries.filter((entry) => entry.isFile() && /\.(sql|sum|json|d\.ts)$/.test(entry.name));
  const assets = await Promise.all(paths.map(async (entry) => ({ type: "Text" as const,
    path: join(entry.parentPath, entry.name), contents: await readFile(join(entry.parentPath, entry.name), "utf8") })));
  return [{ type: "ESModule" as const, path: join(directory, "index.js") }, ...assets];
}
