import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { experimental_readRawConfig } from 'wrangler';
import { sealedConfig } from '../../lib/release/config.mjs';

const manifest = JSON.parse(readFileSync('release/release.json', 'utf8'));
const scratch = mkdtempSync(`${tmpdir()}/release-config-`);
try {
  for (const unit of ['catalog', 'users', 'edge', 'migrator', 'web']) {
    const source = unit === 'web' ? 'apps/web/wrangler.jsonc' : `workers/${unit}/wrangler.toml`;
    const config = `${scratch}/${source.split('/').at(-1)}`;
    writeFileSync(config, execFileSync('git', ['show', `${manifest.source_sha}:${source}`]));
    const original = experimental_readRawConfig({ config }).rawConfig;
    const image = manifest.images[unit === 'edge' ? 'agent' : unit] ?? '';
    const actual = JSON.parse(readFileSync(`release/${unit}/wrangler.json`, 'utf8'));
    if (!isDeepStrictEqual(actual, sealedConfig(unit, image, original))) throw new Error(`${unit} config is outside the selected source closure`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
