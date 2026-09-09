#!/usr/bin/env bash
# Wrangler issues a short-lived registry credential. Never persist it in artifacts.
set -euo pipefail
permission="${1:?pull or push required}"
case "$permission" in pull|push) ;; *) exit 1 ;; esac
export DOCKER_CONFIG="${RUNNER_TEMP:?runner scratch directory required}/release-registry"
printf 'DOCKER_CONFIG=%s\n' "$DOCKER_CONFIG" >> "$GITHUB_ENV"
mkdir -p "$DOCKER_CONFIG"
chmod 700 "$DOCKER_CONFIG"
permissions=(--pull)
[ "$permission" != push ] || permissions+=(--push)
credentials="$(mktemp)"
trap 'rm -f "$credentials"' EXIT
pnpm exec wrangler containers registries credentials registry.cloudflare.com --json --expiration-minutes 60 "${permissions[@]}" > "$credentials"
jq -er '.password' "$credentials" | docker login registry.cloudflare.com --username "$(jq -er '.username' "$credentials")" --password-stdin
