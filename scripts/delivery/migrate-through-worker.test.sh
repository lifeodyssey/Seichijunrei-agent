#!/usr/bin/env bash
# Behaviour tests for migrate-through-worker.sh (card C3 / #1365).
#
# The defect this script exists to prevent (#1332) is invisible in its source:
# every line reads correctly whether or not the POST waits for the new bundle,
# and the difference only shows as an ordering of real calls. So these run the
# shipped script against a `curl` stub that records every call in order, and
# assert the ORDER and the failure messages — not the text of the script.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/delivery/migrate-through-worker.sh"
SEALED_HEAD="20260904000000_platform_usage_scope"
WORKSPACE=""

fail() { echo "FAIL: $*" >&2; exit 1; }

# `curl` reaches three endpoints here: the OIDC mint, /healthz and /migrate.
# Each call appends its kind to CALL_LOG; /healthz answers STUB_HEADS one entry
# per call (the last entry repeats), /migrate answers STUB_CODES the same way.
make_curl_stub() {
  cat > "$WORKSPACE/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
count_of() { local f="$1" n=0; [ -f "$f" ] && n="$(cat "$f")"; echo $((n + 1)) > "$f"; echo "$n"; }
pick() { local list="$1" index="$2"; awk -v i="$index" '{ print (i + 1 <= NF) ? $(i + 1) : $NF }' <<< "$list"; }
case "$args" in
  *"/healthz"*)
    echo healthz >> "${CALL_LOG:?}"
    printf '{"bundleHead":"%s"}\n' "$(pick "${STUB_HEADS:?}" "$(count_of "$STUB_STATE/healthz")")"
    ;;
  *"/migrate"*)
    echo migrate >> "${CALL_LOG:?}"
    out="${args#*-o }"; out="${out%% *}"
    printf '{"success":true,"appliedHead":"%s"}\n' "${STUB_APPLIED:?}" > "$out"
    pick "${STUB_CODES:?}" "$(count_of "$STUB_STATE/migrate")"
    ;;
  *)
    echo token >> "${CALL_LOG:?}"
    echo '{"value":"oidc-token"}'
    ;;
esac
STUB
  chmod +x "$WORKSPACE/bin/curl"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$WORKSPACE/bin/sleep"
  chmod +x "$WORKSPACE/bin/sleep"
}

setup() {
  WORKSPACE="$(mktemp -d)"
  mkdir -p "$WORKSPACE/bin" "$WORKSPACE/state" "$WORKSPACE/migrations"
  make_curl_stub
  : > "$WORKSPACE/migrations/$SEALED_HEAD.sql"
  export PATH="$WORKSPACE/bin:$PATH"
  export CALL_LOG="$WORKSPACE/calls" STUB_STATE="$WORKSPACE/state"
  export RUNNER_TEMP="$WORKSPACE" MIGRATOR_URL="https://migrator.test"
  export ACTIONS_ID_TOKEN_REQUEST_URL="https://oidc.test/token?a=1"
  export ACTIONS_ID_TOKEN_REQUEST_TOKEN="request-token"
  export BUNDLE_POLL_ATTEMPTS=3 BUNDLE_POLL_SECONDS=0 STALE_BUNDLE_ATTEMPTS=2
  export STUB_HEADS="$SEALED_HEAD" STUB_CODES="200" STUB_APPLIED="$SEALED_HEAD"
  : > "$CALL_LOG"
}

teardown() { rm -rf "$WORKSPACE"; }

run_script() { bash "$SCRIPT" production "$WORKSPACE/migrations" 2>&1; }

calls() { tr '\n' ' ' < "$CALL_LOG"; }

case_applies_after_the_bundle_is_serving() {
  setup
  run_script > "$WORKSPACE/out" || fail "a serving bundle must migrate"
  grep -q "migrator applied $SEALED_HEAD" "$WORKSPACE/out" || fail "must report the applied head"
  [ "$(calls)" = "token healthz migrate " ] || fail "polled: $(calls)"
  teardown
}

case_waits_for_the_new_bundle_before_posting() {
  setup
  STUB_HEADS="old-head old-head $SEALED_HEAD"
  run_script > /dev/null || fail "must migrate once the new bundle serves"
  [ "$(calls)" = "token healthz healthz healthz migrate " ] || fail "did not wait: $(calls)"
  teardown
}

case_fails_when_the_new_bundle_never_serves() {
  setup
  STUB_HEADS="old-head"
  run_script > "$WORKSPACE/out" && fail "a bundle that never updates must fail the release"
  grep -q "never served bundle head $SEALED_HEAD" "$WORKSPACE/out" || fail "wrong message: $(cat "$WORKSPACE/out")"
  grep -q migrate "$CALL_LOG" && fail "must never POST to a stale bundle"
  teardown
}

case_retries_a_409_stale_bundle() {
  setup
  STUB_CODES="409 200"
  run_script > "$WORKSPACE/out" || fail "a 409 must be retried, not fail the release"
  grep -q "409 stale_bundle" "$WORKSPACE/out" || fail "must say why it retried"
  [ "$(calls)" = "token healthz migrate healthz migrate " ] || fail "did not re-poll: $(calls)"
  teardown
}

case_gives_up_on_an_endless_409() {
  setup
  STUB_CODES="409"
  run_script > "$WORKSPACE/out" && fail "an endless 409 must fail the release"
  grep -q "still served a stale bundle after 2 attempts" "$WORKSPACE/out" || fail "wrong message"
  teardown
}

case_fails_on_any_other_status() {
  setup
  STUB_CODES="500"
  run_script > "$WORKSPACE/out" && fail "an HTTP 500 must fail the release"
  grep -q "migrator returned HTTP 500" "$WORKSPACE/out" || fail "wrong message"
  teardown
}

for test_case in \
  case_applies_after_the_bundle_is_serving \
  case_waits_for_the_new_bundle_before_posting \
  case_fails_when_the_new_bundle_never_serves \
  case_retries_a_409_stale_bundle \
  case_gives_up_on_an_endless_409 \
  case_fails_on_any_other_status; do
  "$test_case"
done

echo "PASS: migrate-through-worker.sh"
