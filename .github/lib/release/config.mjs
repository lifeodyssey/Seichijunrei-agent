import { experimental_readRawConfig } from 'wrangler';

export const ENTRIES = { catalog: 'index.js', users: 'index.js', edge: 'entry.js', migrator: 'index.js' };

export function sourceConfig(unit) {
  const config = unit === 'web' ? 'apps/web/wrangler.jsonc' : `workers/${unit}/wrangler.toml`;
  return experimental_readRawConfig({ config }).rawConfig;
}

function sealEnvironment(config, image) {
  const sealed = { ...config };
  delete sealed.build;
  if (sealed.containers) sealed.containers = sealed.containers.map(({ image_build_context, ...container }) => ({ ...container, image }));
  return sealed;
}

export function sealedConfig(unit, image, original = sourceConfig(unit)) {
  if (['edge', 'migrator'].includes(unit) && !/@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('immutable container image required');
  const sealed = sealEnvironment(original, image);
  sealed.main = unit === 'web' ? '.output/server/index.mjs' : `bundle/${ENTRIES[unit]}`;
  sealed.env = Object.fromEntries(Object.entries(original.env).map(([name, config]) => [name, sealEnvironment(config, image)]));
  if (unit === 'migrator') Object.assign(sealed, {
    no_bundle: true, find_additional_modules: true, preserve_file_names: true, base_dir: 'bundle',
    rules: [...(original.rules ?? []), { type: 'Text', globs: ['contract.json', 'migrations/**/*'], fallthrough: true }],
  });
  return sealed;
}
