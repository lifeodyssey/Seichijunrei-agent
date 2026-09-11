import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ENTRIES, sourceConfig, sealedConfig } from '../../lib/release/config.mjs';

const [unit, image = ''] = process.argv.slice(2);
if (!Object.hasOwn(ENTRIES, unit)) throw new Error('unknown release Worker');
const output = resolve('release', unit);
const scratch = mkdtempSync(`${tmpdir()}/release-worker-`);
const sealed = sealedConfig(unit, image);
mkdirSync(`${output}/bundle`, { recursive: true });
writeFileSync(`${output}/wrangler.json`, JSON.stringify(sealed, null, 2));
const original = sourceConfig(unit);
const build = { ...sealed, main: resolve('workers', unit, original.main), rules: original.rules };
if (unit === 'migrator') {
  delete build.no_bundle;
  delete build.find_additional_modules;
  delete build.preserve_file_names;
  delete build.base_dir;
}
writeFileSync(`${scratch}/wrangler.json`, JSON.stringify(build));
try {
  execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--config', `${scratch}/wrangler.json`, '--dry-run', '--env', 'production', '--outdir', `${output}/bundle`], { stdio: 'inherit' });
  if (!existsSync(`${output}/bundle/${ENTRIES[unit]}`)) throw new Error('release entrypoint is absent');
  if (unit === 'migrator') execFileSync('node', ['workers/migrator/scripts/prepare-migrations.ts', `${output}/bundle`], { stdio: 'inherit' });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
