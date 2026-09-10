import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { TestContext } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Miniflare } from "miniflare";
import { dsn, SESSION, IDENTITY } from "./postgres.ts";

export async function businessWorker(context: TestContext, bindings: Record<string, string> = {}, entry = new URL("./business-host.worker.ts", import.meta.url), catalog?: (request: Request) => Promise<Response>) {
  const directory = await mkdtemp(join(tmpdir(), "business-host-"));
  const outfile = join(directory, basename(entry.pathname).replace(/\.ts$/, ".js"));
  const config = join(directory, "wrangler.json");
  await writeFile(config, JSON.stringify({ name: "native-business-host-test", main: entry.pathname,
    compatibility_date: "2026-07-22", compatibility_flags: ["nodejs_compat"] }));
  await promisify(execFile)("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--config", config, "--outdir", directory], {
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(directory, "build.log") }, maxBuffer: 5 * 1024 * 1024,
  });
  const options = { modulesRoot: directory, modules: [{ type: "ESModule" as const, path: outfile }], compatibilityDate: "2026-07-22",
    compatibilityFlags: ["nodejs_compat"], bindings: { AGENT_SVC_DATABASE_URL: dsn, ...bindings }, durableObjectsPersist: join(directory, "state"),
    durableObjects: { SESSION: { className: "BusinessHost", useSQLite: true } },
    ...(catalog === undefined ? {} : { serviceBindings: { CATALOG: catalog } }) };
  let worker = new Miniflare(options);
  context.after(async () => { await worker.dispose(); await rm(directory, { recursive: true, force: true }); });
  await worker.ready;
  return { worker, restart: async () => { await worker.dispose(); worker = new Miniflare(options); await worker.ready; return worker; } };
}

export const submission = { sessionId: SESSION, identityId: IDENTITY, payer: "anon", locale: "ja", clientMessageId: "first", text: "Finish this request" };
