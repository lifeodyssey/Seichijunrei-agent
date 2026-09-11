#!/usr/bin/env bash
# Migrate one environment through the migrator Worker (CI/CD redesign spec §3.1).
#
# CI never holds a database credential, not even a short-lived one (decision 6):
# the job proves who it is with its own GitHub OIDC token, and the migrator
# Worker — which does hold the DSN — decides whether to apply. The sealed head
# is the last file of the migration chain inside the release artifact, so the
# Worker applies exactly what this run packaged.
#
# C3 (#1365) adds the `bundleHead` handshake that closes #1332: `wrangler
# deploy` returning is not the new bundle serving, and the old bundle answering
# a POST would apply a chain this release never packaged. So the head the
# Worker reports on /healthz is polled until it matches, and the Worker's own
# `409 stale_bundle` — the same fact from the other side — is retried rather
# than failing the release.
#
# Usage: MIGRATOR_URL=… migrate-through-worker.sh <environment> [migrations-dir] [contract-file]
set -euo pipefail

TARGET_ENVIRONMENT="${1:?target environment required}"
MIGRATIONS_DIR="${2:-release/migrations}"
CONTRACT_FILE="${3:-release/migrator/bundle/contract.json}"
# shellcheck source=scripts/delivery/migrator-bundle.sh
source "$(dirname "${BASH_SOURCE[0]}")/migrator-bundle.sh"
RESPONSE="${RUNNER_TEMP:-/tmp}/migrate-$TARGET_ENVIRONMENT.json"
# The propagation window: 12 × 5s covers the observed Cloudflare rollout, and
# the tests shrink both so they assert the behaviour, not the wall clock.
BUNDLE_SLEEP="${BUNDLE_POLL_SECONDS:-5}"
STALE_ATTEMPTS="${STALE_BUNDLE_ATTEMPTS:-3}"

fail() { echo "::error title=migration::$*"; exit 1; }
required() { [ -n "${!1:-}" ] || fail "$1 is required for $TARGET_ENVIRONMENT"; }

# Every call below either carries a credential (the OIDC request token, then the
# minted token itself) or decides whether the credential-bearing POST happens, so
# the transport is pinned to TLS. curl refuses a plain-http URL — and a redirect
# that leaves https — instead of sending the token over it (CWE-319).
https_only() { curl --proto '=https' --proto-redir '=https' "$@"; }

sealed_head() {
  find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' -print \
    | sort | tail -n 1 | xargs basename | sed 's/\.sql$//'
}

# `audience` scopes the token to the migrator alone: the same token is rejected
# by Pulumi Cloud and by every other relying party.
oidc_token() {
  required ACTIONS_ID_TOKEN_REQUEST_URL
  required ACTIONS_ID_TOKEN_REQUEST_TOKEN
  https_only -sSfL -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=animichi:github-actions:migrator" | jq -r .value
}

post_migrate() {
  local token="$1" body="$2"
  https_only -sS -o "$RESPONSE" -w '%{http_code}' -X POST \
    "$MIGRATOR_URL/migrate" -H "Authorization: Bearer $token" \
    -H 'content-type: application/json' --max-time 900 -d "$body"
}

# Only an explicit stale-bundle response permits another mutation request.
stale_bundle_response() {
  [ "$1" = 409 ] && jq -e '.error == "stale_bundle" or .error == "stale_prisma_bundle"' "$RESPONSE" > /dev/null
}

# A bundle can change between the health check and POST; re-poll that race only.
trigger() {
  local expected="$1" token="$2" body="$3" attempt=1 code
  while [ "$attempt" -le "$STALE_ATTEMPTS" ]; do
    await_migrator_bundle "$expected" "$PRISMA_REF" || fail "migrator never served bundle head $expected"
    code="$(post_migrate "$token" "$body")"
    [ "$code" = 200 ] && return 0
    stale_bundle_response "$code" || report_failure "migrator returned HTTP $code"
    echo "migrator answered 409 $(jq -r .error "$RESPONSE"); re-polling ($attempt/$STALE_ATTEMPTS)"
    attempt=$((attempt + 1))
    sleep "$BUNDLE_SLEEP"
  done
  report_failure "migrator still served a stale bundle after $STALE_ATTEMPTS attempts"
}

verify() {
  local expected="$1"
  jq -e --arg head "$expected" --arg prisma "$PRISMA_REF" '.success == true and .appliedHead == $head
    and .prisma.markerHash == $prisma
    and (.prisma.migrationsApplied | type == "number" and . >= 0 and . == floor)' "$RESPONSE" >/dev/null \
    || report_failure "migrator did not apply sealed head $expected"
}

# The response body carries the migrator's own error; discarding it left a
# staging failure reading only "migrator returned HTTP 500" (#1216). This
# repository is public, so any DSN in that body is redacted before it is logged.
# Truncation is a substring, not `| head -c`: past the 64 KiB pipe buffer head
# exits first, sed dies on SIGPIPE, and `set -e` takes the function down before
# `fail` reports anything — losing the message on exactly the large bodies that
# most needed it.
report_failure() {
  local body
  body="$(redact_dsn_passwords "$RESPONSE")"
  echo "migrator response body (credentials redacted):"
  echo "${body:0:4000}"
  fail "$1"
}

# PostgreSQL carries the password in URI user-info (`//user:pw@host`), in a URI
# parameter (`?password=pw`), and in keyword/value DSNs (`password=pw`). The last
# two share one rule. Written for BSD and GNU sed alike: no `\b`, no `I` flag.
redact_dsn_passwords() {
  sed -E \
    -e 's#://([^:/@[:space:]]+):[^@[:space:]]+@#://\1:***@#g' \
    -e 's#([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd][[:space:]]*=[[:space:]]*)[^[:space:]&"]+#\1***#g' \
    "$1"
}

main() {
  required MIGRATOR_URL
  local expected token body
  expected="$(sealed_head)"
  [ -n "$expected" ] || fail "$MIGRATIONS_DIR carries no migration to apply"
  PRISMA_REF="$(jq -er '.storage.storageHash | select(type == "string" and test("^[a-f0-9]{64}$"))' "$CONTRACT_FILE")"
  body="$(selected_metadata "$expected")"
  token="$(oidc_token)"
  echo "migrating $TARGET_ENVIRONMENT to sealed head $expected"
  trigger "$expected" "$token" "$body"
  verify "$expected"
  echo "migrator applied $expected"
}

selected_metadata() {
  local baseline=false
  [ -s "$MIGRATIONS_DIR/atlas.sum" ] || fail "$MIGRATIONS_DIR carries no checksum metadata"
  [ ! -f "$MIGRATIONS_DIR/STAGING_ONLY_BASELINE" ] || baseline=true
  jq -cn --arg expectedHead "$1" --rawfile atlasSum "$MIGRATIONS_DIR/atlas.sum" \
    --argjson stagingOnlyBaseline "$baseline" --arg expectedPrismaRef "$PRISMA_REF" \
    '{expectedHead:$expectedHead,atlasSum:$atlasSum,stagingOnlyBaseline:$stagingOnlyBaseline,expectedPrismaRef:$expectedPrismaRef}'
}

main
