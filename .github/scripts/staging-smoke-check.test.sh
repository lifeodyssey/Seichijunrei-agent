#!/usr/bin/env bash
# Behavior tests for the staging smoke check (#1198 park lifted by owner decision,
# docs/specs/2026-08-26-system-health-audit.md §6.3): the script must fail closed on a
# broken healthz, a broken SSR shell, or a status that never recovers, and must retry
# through the deploy-propagation window before giving up, and it must present the
# Cloudflare Access service token when one is declared and refuse half of one (D3 #1369).
# A `curl` stub stands in for the network so the behavior is asserted without reaching a
# real staging host; it also records its own argv, which is how the header assertions read
# what the probe actually sent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/staging-smoke-check.sh"
TMP="$(mktemp -d)"
LAST_STATE_DIR=""
trap 'rm -rf "$TMP" "$LAST_STATE_DIR"' EXIT

fail=0
mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<'STUB'
#!/usr/bin/env bash
# `curl -sS --max-time 15 -w '\n%{http_code}' <url>`: the URL is always the last arg.
# Counts calls per endpoint so a case can fail N times before recovering.
set -euo pipefail
url="${*: -1}"
state_dir="${STUB_STATE_DIR:?}"
printf '%s\n' "$*" >> "$state_dir/argv"
if [[ "$url" == */healthz ]]; then
  name=healthz
  mode="${STUB_HEALTHZ_MODE:-ok}"
  retry_until="${STUB_HEALTHZ_RETRY_UNTIL:-0}"
else
  name=root
  mode="${STUB_ROOT_MODE:-ok}"
  retry_until="${STUB_ROOT_RETRY_UNTIL:-0}"
fi
state="$state_dir/calls-$name"
count=0
[ -f "$state" ] && count="$(cat "$state")"
count=$((count + 1))
echo "$count" > "$state"
[ "$count" -le "$retry_until" ] && mode=http500

case "$mode" in
  http500) printf '%s\n%s\n' 'unavailable' 500 ;;
  bad-status) printf '%s\n%s\n' '{"status":"degraded"}' 200 ;;
  no-marker) printf '%s\n%s\n' '<html></html>' 200 ;;
  *)
    if [ "$name" = healthz ]; then
      printf '%s\n%s\n' '{"status":"ok","service":"animichi-runtime"}' 200
    else
      printf '%s\n%s\n' '<div class="app-splash"></div>' 200
    fi
    ;;
esac
STUB
chmod +x "$TMP/bin/curl"

# `LAST_STATE_DIR` (declared above, beside the EXIT trap that removes it) holds
# the state dir of the most recent `run`, so a case can read the argv the stub
# recorded. `env -u` makes every case hermetic: an operator with a real Access
# token exported would otherwise change what the "no token" cases assert.
run() { # run <label> <want-exit> [env...]
  run_at "https://staging.example.test" "$@"
}

run_at() { # run_at <url> <label> <want-exit> [env...]
  local url="$1" label="$2" want="$3"; shift 3
  local out rc
  rm -rf "$LAST_STATE_DIR"
  LAST_STATE_DIR="$(mktemp -d)"
  out="$(env -u CF_ACCESS_CLIENT_ID -u CF_ACCESS_CLIENT_SECRET "$@" \
    STUB_STATE_DIR="$LAST_STATE_DIR" PATH="$TMP/bin:$PATH" \
    bash "$SCRIPT" "$url" 2>&1)" && rc=0 || rc=$?
  if [ "$rc" -eq "$want" ]; then
    printf 'PASS %-60s exit=%s\n' "$label" "$rc"
  else
    fail=$((fail + 1))
    printf 'FAIL %-60s want=%s got=%s\n%s\n' "$label" "$want" "$rc" "$out"
  fi
}

sent_headers() { cat "$LAST_STATE_DIR/argv" 2>/dev/null || true; }

expect_sent() { # expect_sent <label> <want-present:0|1> <pattern>
  local label="$1" want="$2" pattern="$3" present=0
  grep -q -- "$pattern" <<<"$(sent_headers)" && present=1
  if [ "$present" -eq "$want" ]; then
    printf 'PASS %-60s\n' "$label"
  else
    fail=$((fail + 1))
    printf 'FAIL %-60s want-present=%s got=%s\n%s\n' "$label" "$want" "$present" "$(sent_headers)"
  fi
}

echo "=== a healthy staging cohort ==="
run "healthz ok and an SSR shell with app-splash pass on the first attempt" 0 \
  SMOKE_ATTEMPTS=1 SMOKE_RETRY_DELAY=0

echo
echo "=== fail-closed on each surface the checks cover ==="
run "a non-200 healthz fails closed" 1 \
  SMOKE_ATTEMPTS=1 SMOKE_RETRY_DELAY=0 STUB_HEALTHZ_MODE=http500
run "a healthz body without status=ok fails closed" 1 \
  SMOKE_ATTEMPTS=1 SMOKE_RETRY_DELAY=0 STUB_HEALTHZ_MODE=bad-status
run "a non-200 SSR shell fails closed" 1 \
  SMOKE_ATTEMPTS=1 SMOKE_RETRY_DELAY=0 STUB_ROOT_MODE=http500
run "an SSR shell missing the app-splash marker fails closed" 1 \
  SMOKE_ATTEMPTS=1 SMOKE_RETRY_DELAY=0 STUB_ROOT_MODE=no-marker

echo
echo "=== retries cover deploy propagation, then give up ==="
run "a healthz that recovers within the retry budget passes" 0 \
  SMOKE_ATTEMPTS=2 SMOKE_RETRY_DELAY=0 STUB_HEALTHZ_RETRY_UNTIL=1
run "a healthz that never recovers fails after the attempt budget is spent" 1 \
  SMOKE_ATTEMPTS=2 SMOKE_RETRY_DELAY=0 STUB_HEALTHZ_RETRY_UNTIL=999

echo
echo "=== the Cloudflare Access service token (D3 #1369) ==="
run "a declared service token still passes a healthy cohort" 0 \
  SMOKE_ATTEMPTS=1 SMOKE_RETRY_DELAY=0 \
  CF_ACCESS_CLIENT_ID=id.access CF_ACCESS_CLIENT_SECRET=not-a-real-secret
expect_sent "the client id header rides on every probe" 1 "CF-Access-Client-Id: id.access"
expect_sent "the client secret header rides with it" 1 "CF-Access-Client-Secret: not-a-real-secret"

run "no declared token is the ordinary case, not a failure" 0 \
  SMOKE_ATTEMPTS=1 SMOKE_RETRY_DELAY=0
expect_sent "an undeclared token sends no Access header at all" 0 "CF-Access-Client-"

run "only the client id declared fails closed" 1 \
  SMOKE_ATTEMPTS=1 SMOKE_RETRY_DELAY=0 CF_ACCESS_CLIENT_ID=id.access
expect_sent "and sends nothing, rather than half a token" 0 "CF-Access-Client-"
run "only the client secret declared fails closed" 1 \
  SMOKE_ATTEMPTS=1 SMOKE_RETRY_DELAY=0 CF_ACCESS_CLIENT_SECRET=not-a-real-secret

echo
echo "=== the token is never sent to this machine (PR #1498 review) ==="
# One row per form of `isLoopbackHostname` in
# packages/contract/src/access-service-token.ts, which this script mirrors in a
# `case` pattern. A gap in either spelling hands staging's real service token to
# whatever is listening on that port.
for target in \
  http://localhost:3000 \
  http://app.localhost:3000 \
  http://127.0.0.1:8787 \
  http://127.0.0.2:3000 \
  "http://[::1]:3000" \
  http://0.0.0.0:8080
do
  run_at "$target" "a declared token against $target is refused" 1 \
    SMOKE_ATTEMPTS=1 SMOKE_RETRY_DELAY=0 \
    CF_ACCESS_CLIENT_ID=id.access CF_ACCESS_CLIENT_SECRET=not-a-real-secret
  expect_sent "and $target is sent no Access header" 0 "CF-Access-Client-"
done

# The control for the block above. If the predicate answered "loopback" for
# everything, every row would pass while every real staging probe went out bare.
run_at "https://staging.example.test" "a remote target still gets the token" 0 \
  SMOKE_ATTEMPTS=1 SMOKE_RETRY_DELAY=0 \
  CF_ACCESS_CLIENT_ID=id.access CF_ACCESS_CLIENT_SECRET=not-a-real-secret
expect_sent "and a remote target keeps its client id header" 1 "CF-Access-Client-Id: id.access"

# The loopback probe is only refused when a token is declared: an ordinary
# `wrangler dev` smoke run has no credential to leak and must still work.
run_at "http://localhost:3000" "an undeclared token against the loopback still passes" 0 \
  SMOKE_ATTEMPTS=1 SMOKE_RETRY_DELAY=0

echo
echo "=== the script's spellings match the one TS definition (PR #1498 review) ==="
# The script cannot import TypeScript, so it re-spells what
# `packages/contract/src/access-service-token.ts` owns: the two variable names,
# the two header names, and the loopback list. Drift is silent in both
# directions — a header Access does not read, or a loopback form the script
# hands staging's real token to.
CONTRACT="$ROOT/packages/contract/src/access-service-token.ts"
for literal in CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET \
  CF-Access-Client-Id CF-Access-Client-Secret \
  localhost .localhost '[::1]' '[::]' 0.0.0.0 127.
do
  if grep -qF -- "$literal" "$SCRIPT" && grep -qF -- "$literal" "$CONTRACT"; then
    printf 'PASS %-60s\n' "both files spell $literal"
  else
    fail=$((fail + 1))
    printf 'FAIL %-60s\n' "only one of the two files spells $literal"
  fi
done

echo
if [ "$fail" -eq 0 ]; then
  echo "All staging-smoke-check tests passed."
else
  echo "$fail staging-smoke-check test(s) failed." >&2
  exit 1
fi
