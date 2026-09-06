#!/usr/bin/env bash
# Seal one Worker into the release tree: the prebuilt bundle Wrangler publishes
# with `--no-bundle`, and the deploy-time config that sits next to it.
#
# The image reference is written into the shipped config here and nowhere else.
# Until C1 the reference was rewritten twice — once at build time and again at
# promotion, under a second `prod-<sha>-<digest>` tag — so the bytes production
# started were never the bytes staging was smoke-checked on. Production now
# deploys this same config, so it runs the same `sha-<sha>` image.
#
# Usage: bundle-release-worker.sh <unit> <wrangler-env> [image-ref]
set -euo pipefail

UNIT="${1:?worker unit required}"
BUILD_ENV="${2:?wrangler environment to bundle for required}"
IMAGE_REF="${3:-}"

SOURCE_DIR="workers/$UNIT"
SOURCE_CONFIG="$SOURCE_DIR/wrangler.toml"
OUT_DIR="release/$UNIT"

fail() { echo "::error title=release bundle::$*"; exit 1; }

# `main` is the Worker's entry module; esbuild names the emitted file after it,
# and the stage jobs pass that name to `wrangler deploy` positionally.
main_module() {
  sed -n 's/^main = "\(.*\)"$/\1/p' "$SOURCE_CONFIG"
}

seal_config() {
  [ -n "$IMAGE_REF" ] || { cp "$SOURCE_CONFIG" "$OUT_DIR/wrangler.toml"; return 0; }
  sed "s#^image = \".*\"#image = \"$IMAGE_REF\"#" "$SOURCE_CONFIG" > "$OUT_DIR/wrangler.toml"
  grep -Fq "$IMAGE_REF" "$OUT_DIR/wrangler.toml" || fail "$UNIT config does not reference $IMAGE_REF"
}

# The dry run reads a config outside the Worker's directory, so its `main` has
# to be absolute. The sealed config keeps the repository-relative one: the stage
# jobs name the entry file positionally, which overrides it.
build_config() {
  local main="$1" scratch
  scratch="$(mktemp -d)"
  sed "s#^main = \"$main\"#main = \"$PWD/$SOURCE_DIR/$main\"#" "$OUT_DIR/wrangler.toml" \
    > "$scratch/wrangler.toml"
  printf '%s\n' "$scratch/wrangler.toml"
}

main() {
  local main_module entry config
  main_module="$(main_module)"
  [ -n "$main_module" ] || fail "$SOURCE_CONFIG declares no main module"
  entry="$(basename "${main_module%.ts}").js"
  mkdir -p "$OUT_DIR/bundle"
  seal_config
  config="$(build_config "$main_module")"
  pnpm exec wrangler deploy -c "$config" --dry-run -e "$BUILD_ENV" --outdir "$OUT_DIR/bundle"
  [ -f "$OUT_DIR/bundle/$entry" ] || fail "$UNIT bundle has no $entry entry point"
}

main
