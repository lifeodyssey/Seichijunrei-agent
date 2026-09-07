#!/usr/bin/env bash
# Behavioral tests for pre-push-affected.sh (#1371).
#
# Hermetic: every case builds a throwaway git repository under one temp root,
# gives it its own `origin/main`, puts a fake `pnpm` / `make` / `atlas` on PATH
# and stubs the three documentation checks. Nothing here runs a real suite, a
# container or a network call — what is under test is the routing, and the fake
# pnpm both answers `ls -r --depth -1 --json` and records every `run` it is
# asked for, which is how the closure prefix and the selected set are asserted.
#
# GATE_UNDER_TEST points the suite at a mutant, which is how the mutations in
# the commit body were run.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
GATE="${GATE_UNDER_TEST:-$PWD/scripts/local-gates/pre-push-affected.sh}"
# The shape `pnpm ls` answers with: the root project and the Python agent are
# in it precisely so the cases can prove the gate subtracts them.
PROJECTS='.:animichi-cloudflare-worker apps/agent:@animichi/agent apps/web:web workers/catalog:catalog workers/users:users'
ZERO=0000000000000000000000000000000000000000
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT
failures=0
reported=0

fail() { printf 'FAIL %s: %s\n' "$1" "$2" >&2; failures=$((failures + 1)); }
# Reports the case just closed, not a wish: a case whose assertions added
# failures since the last report prints `not ok`, so a mutant's output cannot
# read as green anywhere.
ok() {
  if [ "$failures" = "$reported" ]; then printf 'ok: %s\n' "$1"; else printf 'not ok: %s\n' "$1"; fi
  reported="$failures"
}
expect() { case "$3" in *"$2"*) ;; *) fail "$1" "expected to see '$2' in: $3" ;; esac; }
refute() { case "$3" in *"$2"*) fail "$1" "did not expect '$2' in: $3" ;; esac; }
expect_status() { [ "$2" = "$3" ] || fail "$1" "expected exit $2, got $3"; }

new_repo() {
  REPO="$(mktemp -d "$TMPROOT/case.XXXXXX")"
  BIN="$REPO/.bin"
  INVOCATIONS="$REPO/.invocations"
  export INVOCATIONS
  export PNPM_PROJECTS="$PROJECTS"
  mkdir -p "$BIN" "$REPO/scripts/local-gates"
  : > "$INVOCATIONS"
  # `ls` answers the project list built from $PWD, which the gate has already
  # cd'd to its toplevel — so the paths it strips are the ones it computed.
  cat > "$BIN/pnpm" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = ls ]; then
  jq -n --arg root "$PWD" --arg spec "$PNPM_PROJECTS" \
    '$spec | split(" ") | map(select(length > 0) | split(":")) | map({name: .[1], path: ($root + "/" + .[0])})'
  exit 0
fi
printf 'pnpm %s\n' "$*" >> "$INVOCATIONS"
STUB
  for tool in make atlas; do
    printf '#!/usr/bin/env bash\nprintf "%s %%s\\n" "$*" >> "$INVOCATIONS"\n' "$tool" > "$BIN/$tool"
  done
  for check in agents-refs docs-paths root-allowlist; do
    printf '#!/usr/bin/env bash\nprintf "check-%s\\n" >> "$INVOCATIONS"\n' "$check" \
      > "$REPO/scripts/local-gates/check-$check.sh"
  done
  chmod +x "$BIN"/* "$REPO/scripts/local-gates"/*.sh
  cp "$GATE" "$REPO/scripts/local-gates/pre-push-affected.sh"
  (
    cd "$REPO"
    git init -q -b main
    git config user.email gate@test.invalid
    git config user.name gate
    git add -A
    git commit -qm "base"
    git update-ref refs/remotes/origin/main HEAD
  )
}

commit_change() { # <branch> <path>...
  local branch="$1"
  shift
  (
    cd "$REPO"
    git checkout -q -B "$branch" main
    for path in "$@"; do
      mkdir -p "$(dirname "$path")"
      printf 'probe\n' > "$path"
    done
    git add -A
    git commit -qm "change"
  )
}

run_gate() { # stdin is the caller's; GATE_ENV carries any extra environment
  set +e
  OUT="$(cd "$REPO" && PATH="$BIN:$PATH" env "${GATE_ENV[@]}" \
    bash scripts/local-gates/pre-push-affected.sh 2>&1)"
  STATUS=$?
  set -e
  RECORDED="$(cat "$INVOCATIONS")"
}
GATE_ENV=(GATE_PROBE=1)

# 1. A selected package must not carry an unowned path through with it.
new_repo
commit_change feature workers/catalog/src/x.ts new-root.txt
run_gate < /dev/null
expect_status "mixed diff" 1 "$STATUS"
expect "mixed diff" "no gate covers" "$OUT"
expect "mixed diff" "new-root.txt" "$OUT"
refute "mixed diff" "workers/catalog/src/x.ts" "$OUT"
ok "a package change does not carry an unowned root file through"

# 2. Same, for a bucket rather than a package — and the bucket must not run.
new_repo
commit_change feature apps/agent/x.py tools/y.sh
run_gate < /dev/null
expect_status "agent + stray" 1 "$STATUS"
expect "agent + stray" "tools/y.sh" "$OUT"
refute "agent + stray" "apps/agent/x.py" "$OUT"
refute "agent + stray" "check" "$RECORDED"
ok "an agent-bucket change does not carry an unowned path through"

# 3. A root manifest selects every package, and drops the dependent closure.
new_repo
commit_change feature pnpm-lock.yaml
run_gate < /dev/null
expect_status "lockfile" 0 "$STATUS"
expect "lockfile" "deps=1" "$OUT"
for name in web catalog users; do
  expect "lockfile" "--filter $name run" "$RECORDED"
done
refute "lockfile" "--filter ...web" "$RECORDED"
refute "lockfile" "@animichi/agent" "$RECORDED"
refute "lockfile" "animichi-cloudflare-worker" "$RECORDED"
ok "a root manifest selects every package once, without the closure prefix"

# 4. Whitelisted paths need no package; the docs bucket still runs its checks.
new_repo
commit_change feature docs/a.md .github/workflows/x.yml
run_gate < /dev/null
expect_status "docs" 0 "$STATUS"
expect "docs" "packages: (none)" "$OUT"
for check in agents-refs docs-paths root-allowlist; do
  expect "docs" "check-$check" "$RECORDED"
done
refute "docs" "--filter" "$RECORDED"
ok "a docs and workflow change runs the documentation checks and no package"

# 5. git's pre-push record routes the ref being pushed, not the checked-out one.
new_repo
commit_change other workers/users/src/u.ts
other_sha="$(cd "$REPO" && git rev-parse other)"
commit_change feature workers/catalog/src/c.ts
run_gate <<< "refs/heads/other $other_sha refs/heads/other $ZERO"
expect_status "pushed ref" 0 "$STATUS"
expect "pushed ref" "packages: users" "$OUT"
refute "pushed ref" "catalog" "$OUT"
ok "a stdin record routes the pushed ref rather than HEAD"

# 6. pre-commit's wrapper eats that stdin and re-exports the record instead.
GATE_ENV=(PRE_COMMIT_TO_REF="$other_sha" PRE_COMMIT_FROM_REF="$ZERO")
run_gate < /dev/null
expect_status "PRE_COMMIT_TO_REF" 0 "$STATUS"
expect "PRE_COMMIT_TO_REF" "packages: users" "$OUT"
refute "PRE_COMMIT_TO_REF" "catalog" "$OUT"
GATE_ENV=(GATE_PROBE=1)
ok "PRE_COMMIT_TO_REF routes the same ref when stdin carries no record"

# 7. An empty project list must fail closed, not select everything or nothing.
new_repo
export PNPM_PROJECTS=""
commit_change feature workers/catalog/src/x.ts
run_gate < /dev/null
expect_status "no projects" 1 "$STATUS"
expect "no projects" "no gate covers" "$OUT"
expect "no projects" "workers/catalog/src/x.ts" "$OUT"
ok "an empty project list fails closed instead of matching every path"

# 8. No base to diff against is a broken gate, and a broken gate blocks.
new_repo
commit_change feature workers/catalog/src/x.ts
(cd "$REPO" && git update-ref -d refs/remotes/origin/main)
run_gate < /dev/null
[ "$STATUS" != 0 ] || fail "no origin/main" "expected a non-zero exit, got 0"
ok "a missing origin/main fails the push rather than gating nothing"

[ "$failures" = 0 ] || { printf '%s case(s) failed\n' "$failures" >&2; exit 1; }
printf 'pre-push-affected.test.sh: all green\n'
