#!/usr/bin/env bash
# #1198 park lifted by owner decision (docs/specs/2026-08-26-system-health-audit.md §6.3):
# staging deploys were verified only by exit code, never by an actual request. This checks
# the two surfaces a broken staging deploy breaks first — the agent healthz probe (via the
# edge worker) and the SSR shell — with retries for deploy propagation, and fails closed so
# a broken staging blocks promote-production instead of silently passing it on.
set -euo pipefail

BASE_URL="${1:?staging edge base URL required}"
# The web app lives on its own worker: the zone hostname routes `/` to it,
# but on workers.dev each worker only answers for itself — so the SSR-shell
# probe needs the web worker's own origin, not the edge's.
WEB_URL="${2:-$BASE_URL}"
ATTEMPTS="${SMOKE_ATTEMPTS:-3}"
RETRY_DELAY="${SMOKE_RETRY_DELAY:-10}"

fail() { echo "::error title=staging smoke::$*"; exit 1; }

# The Cloudflare Access service token this probe presents (D3 #1369). Empty
# until the ESC environment carries the pair, which is the whole transitional
# state PR 1 ships in: staging has no Access application in front of it yet, so
# an unset token is the ordinary case and not a failure.
#
# Half a token IS a failure, and a loud one. Access answers a request carrying
# one of the two headers exactly as it answers one carrying neither — a 302 to
# the identity provider's login page — so the probe would read an HTML login
# page where it expected JSON and report a broken deploy. Naming the missing
# variable is the difference between that and one export.
ACCESS_HEADERS=()

read_access_service_token() {
  local id="${CF_ACCESS_CLIENT_ID:-}" secret="${CF_ACCESS_CLIENT_SECRET:-}"
  if [ -n "$id" ] && [ -n "$secret" ]; then
    ACCESS_HEADERS=(-H "CF-Access-Client-Id: $id" -H "CF-Access-Client-Secret: $secret")
    return
  fi
  if [ -n "$id" ]; then fail "CF_ACCESS_CLIENT_SECRET is unset while CF_ACCESS_CLIENT_ID is set: Cloudflare Access takes both headers or neither"; fi
  if [ -n "$secret" ]; then fail "CF_ACCESS_CLIENT_ID is unset while CF_ACCESS_CLIENT_SECRET is set: Cloudflare Access takes both headers or neither"; fi
}

http_body_and_code() {
  curl -sS --max-time 15 -w '\n%{http_code}' ${ACCESS_HEADERS[@]+"${ACCESS_HEADERS[@]}"} "$1"
}

healthz_ok() {
  local response code body
  response="$(http_body_and_code "$BASE_URL/healthz")" || return 1
  code="${response##*$'\n'}"
  body="${response%$'\n'*}"
  [ "$code" = "200" ] || { echo "healthz returned HTTP $code: $body" >&2; return 1; }
  jq -e '.status == "ok"' <<<"$body" >/dev/null 2>&1 || { echo "healthz body missing status=ok: $body" >&2; return 1; }
}

shell_ok() {
  local response code body
  response="$(http_body_and_code "$WEB_URL/")" || return 1
  code="${response##*$'\n'}"
  body="${response%$'\n'*}"
  [ "$code" = "200" ] || { echo "/ returned HTTP $code" >&2; return 1; }
  grep -q 'app-splash' <<<"$body" || { echo "/ body is missing the app-splash SSR marker" >&2; return 1; }
}

run_checks() { healthz_ok && shell_ok; }

main() {
  local attempt=1
  read_access_service_token
  while ! run_checks; do
    [ "$attempt" -lt "$ATTEMPTS" ] || fail "staging smoke check failed after $ATTEMPTS attempts"
    echo "staging smoke check attempt $attempt failed; retrying in ${RETRY_DELAY}s" >&2
    sleep "$RETRY_DELAY"
    attempt=$((attempt + 1))
  done
  echo "staging smoke check passed on attempt $attempt"
}

main
