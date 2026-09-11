#!/usr/bin/env bash
set -euo pipefail
case "${1:?environment required}" in staging|production) ;; *) exit 1 ;; esac
: "${SOURCE_SHA:?selected source required}"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1
for unit in catalog users edge web; do
  pnpm exec wrangler deploy --no-bundle --config "release/$unit/wrangler.json" --env "$1" --tag "sha-$SOURCE_SHA"
done
