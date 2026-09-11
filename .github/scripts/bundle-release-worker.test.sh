#!/usr/bin/env bash
# Exercise the native Wrangler bundler, including real module/asset resolution.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
[ ! -e release ] || { echo 'release already exists; refusing to overwrite it' >&2; exit 1; }
mkdir release
trap 'rm -rf release' EXIT
agent="registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/animichi-agent@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
migrator="registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/animichi-migrator@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
node .github/scripts/release/build-worker.mjs catalog
node .github/scripts/release/build-worker.mjs users
node .github/scripts/release/build-worker.mjs edge "$agent"
node .github/scripts/release/build-worker.mjs migrator "$migrator"
[ -s release/catalog/bundle/index.js ]
[ -s release/users/bundle/index.js ]
[ -s release/edge/bundle/entry.js ]
[ -s release/migrator/bundle/index.js ]
jq -e --arg image "$agent" '.containers[0].image == $image and .env.staging.containers[0].image == $image and .env.production.containers[0].image == $image' release/edge/wrangler.json > /dev/null
jq -e --arg image "$migrator" '.containers[0].image == $image and .env.staging.containers[0].image == $image and .env.production.containers[0].image == $image' release/migrator/wrangler.json > /dev/null
jq -e '.main == "bundle/entry.js" and (.build == null) and (.env.staging.containers[0].image_build_context == null)' release/edge/wrangler.json > /dev/null
for environment in staging production; do
  for unit in catalog users edge migrator; do
    pnpm exec wrangler deploy --no-bundle --config "release/$unit/wrangler.json" --env "$environment" --dry-run
  done
done
echo 'native release bundles: all assertions hold'
