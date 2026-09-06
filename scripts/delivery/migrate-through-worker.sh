#!/usr/bin/env bash
# Migrate one environment through the migrator Worker (CI/CD redesign spec §3.1).
#
# CI never holds a database credential, not even a short-lived one (decision 6):
# the job proves who it is with its own GitHub OIDC token, and the migrator
# Worker — which does hold the DSN — decides whether to apply. The sealed head
# is the last file of the migration chain inside the release artifact, so the
# Worker applies exactly what this run packaged.
#
# C3 (#1365) adds the `bundleHead` poll that closes #1332 ("deploy returned" is
# not "the new bundle is serving") and the bounded 409 retry around it.
#
# Usage: MIGRATOR_URL=… migrate-through-worker.sh <environment> [migrations-dir]
set -euo pipefail

TARGET_ENVIRONMENT="${1:?target environment required}"
MIGRATIONS_DIR="${2:-release/migrations}"
RESPONSE="${RUNNER_TEMP:-/tmp}/migrate-$TARGET_ENVIRONMENT.json"

fail() { echo "::error title=migration::$*"; exit 1; }
required() { [ -n "${!1:-}" ] || fail "$1 is required for $TARGET_ENVIRONMENT"; }

sealed_head() {
  find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' -print \
    | sort | tail -n 1 | xargs basename | sed 's/\.sql$//'
}

# `audience` scopes the token to the migrator alone: the same token is rejected
# by Pulumi Cloud and by every other relying party.
oidc_token() {
  required ACTIONS_ID_TOKEN_REQUEST_URL
  required ACTIONS_ID_TOKEN_REQUEST_TOKEN
  curl -sSfL -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=animichi:github-actions:migrator" | jq -r .value
}

trigger() {
  local expected="$1" token="$2" body code
  body="$(jq -cn --arg expectedHead "$expected" '{expectedHead:$expectedHead}')"
  code="$(curl -sS -o "$RESPONSE" -w '%{http_code}' -X POST \
    "$MIGRATOR_URL/migrate" -H "Authorization: Bearer $token" \
    -H 'content-type: application/json' --max-time 900 -d "$body")"
  [ "$code" = 200 ] || report_failure "migrator returned HTTP $code"
}

verify() {
  local expected="$1"
  jq -e --arg head "$expected" '.success == true and .appliedHead == $head' "$RESPONSE" >/dev/null \
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
  local expected token
  expected="$(sealed_head)"
  [ -n "$expected" ] || fail "$MIGRATIONS_DIR carries no migration to apply"
  token="$(oidc_token)"
  echo "migrating $TARGET_ENVIRONMENT to sealed head $expected"
  trigger "$expected" "$token"
  verify "$expected"
  echo "migrator applied $expected"
}

main
