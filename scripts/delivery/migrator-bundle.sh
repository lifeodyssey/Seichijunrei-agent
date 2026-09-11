#!/usr/bin/env bash
# Poll the selected executor's two native migration identities through HTTPS.

matches_migrator_bundle() {
  curl --proto '=https' --proto-redir '=https' -sS --max-time 15 "${MIGRATOR_URL%/}/healthz" |
    jq -e --arg atlas "$1" --arg prisma "${2:-}" '.bundleHead == $atlas
      and ($prisma == "" or .prismaTarget == $prisma)' > /dev/null
}

await_migrator_bundle() {
  local attempt
  for ((attempt=1; attempt<=${BUNDLE_POLL_ATTEMPTS:-12}; attempt++)); do
    if matches_migrator_bundle "$@"; then return 0; fi
    echo "waiting for selected migration executor ($attempt/${BUNDLE_POLL_ATTEMPTS:-12})"
    sleep "${BUNDLE_POLL_SECONDS:-5}"
  done
  return 1
}
