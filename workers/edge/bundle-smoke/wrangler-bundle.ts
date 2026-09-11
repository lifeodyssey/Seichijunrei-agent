/** The official dry-run build includes Workers' Node compatibility plugins and supplies its own graph. */
import { URL } from "node:url";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import type { Metafile } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface WranglerBundle { readonly code: string; readonly metafile: Metafile }

export async function bundleLikeWrangler(entry: string, outfile: string): Promise<WranglerBundle> {
  const directory = dirname(outfile);
  const config = `${outfile}.config.json`;
  const metafile = `${outfile}.meta.json`;
  const runtime = deployedRuntime();
  await writeFile(config, JSON.stringify({ name: "native-bundle-probe", main: entry,
    compatibility_date: runtime.compatibilityDate, compatibility_flags: runtime.compatibilityFlags }));
  await promisify(execFile)("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--config", config, "--outdir", directory, "--metafile", metafile], {
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: `${outfile}.build.log` }, maxBuffer: 5 * 1024 * 1024,
  });
  const generated = join(directory, basename(entry).replace(/\.[cm]?ts$/, ".js"));
  const code = await readFile(generated, "utf8");
  await writeFile(outfile, code);
  return { code, metafile: JSON.parse(await readFile(metafile, "utf8")) as Metafile };
}

/** Build and execute with the exact compatibility settings declared for production. */
export function deployedRuntime(): { compatibilityDate: string; compatibilityFlags: string[] } {
  const root = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8").split(/^\[/m)[0] ?? "";
  const date = /^compatibility_date\s*=\s*"([^"]+)"/m.exec(root)?.[1];
  const flags = /^compatibility_flags\s*=\s*(.+)$/m.exec(root)?.[1];
  assert.ok(date && flags, "Production declares its compatibility settings");
  return { compatibilityDate: date, compatibilityFlags: [...flags.matchAll(/"([^"]+)"/g)].map((flag) => flag[1] ?? "") };
}
