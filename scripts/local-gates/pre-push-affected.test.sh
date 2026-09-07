#!/usr/bin/env bash
# Behavioral tests for pre-push-affected.sh (#1371).
#
# Hermetic: every case builds a throwaway git repository under one temp root
# with its own `origin/main`, a fake `pnpm` / `make` / `atlas` on PATH and the
# three documentation checks stubbed. No real suite, container or network call.
# The fake pnpm does double duty — it answers `ls -r --depth -1 --json` and
# records every `run` asked of it, which is how the selected set and the absence
# of the `...` closure are asserted. GATE_UNDER_TEST points at a mutant.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
GATE="${GATE_UNDER_TEST:-$PWD/scripts/local-gates/pre-push-affected.sh}"
# The root project and the Python agent are in the list so the cases can prove
# the gate subtracts them.
PROJECTS='.:animichi-cloudflare-worker apps/agent:@animichi/agent apps/web:web workers/catalog:catalog workers/users:users'
ZERO=0000000000000000000000000000000000000000
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT
failures=0
reported=0

fail() { printf 'FAIL %s: %s\n' "$1" "$2" >&2; failures=$((failures + 1)); }
# Reports the case just closed: one whose assertions added failures since the
# last report prints `not ok`, so a mutant cannot read as green anywhere.
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
  # `ls` builds the list from $PWD, which the gate has already cd'd to its
  # toplevel, so the paths it strips are the ones it computed.
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
  OUT="$(cd "$REPO" && PATH="$BIN:$PATH" env "${GATE_ENV[@]}" bash scripts/local-gates/pre-push-affected.sh 2>&1)"
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

# 2. Same for a bucket, which must also not have run.
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

# 5. A ref that is not HEAD is refused: its paths would be gated against the
#    checked-out tree, so a broken change could pass on another branch's green.
new_repo
commit_change other workers/users/src/u.ts
other_sha="$(cd "$REPO" && git rev-parse other)"
commit_change feature workers/catalog/src/c.ts
head_sha="$(cd "$REPO" && git rev-parse HEAD)"
run_gate <<< "refs/heads/other $other_sha refs/heads/other $ZERO"
expect_status "non-HEAD ref" 1 "$STATUS"
expect "non-HEAD ref" "refs must be pushed from their own worktree" "$OUT"
expect "non-HEAD ref" "HEAD is $head_sha" "$OUT"
expect "non-HEAD ref" "refs/heads/other@$other_sha" "$OUT"
refute "non-HEAD ref" "packages:" "$OUT"
ok "a record for a ref other than HEAD is refused, naming both shas"

# 6. The common wrapper case: pre-commit re-exports HEAD's own sha.
GATE_ENV=(PRE_COMMIT_TO_REF="$head_sha" PRE_COMMIT_FROM_REF="$ZERO")
run_gate < /dev/null
expect_status "PRE_COMMIT_TO_REF" 0 "$STATUS"
expect "PRE_COMMIT_TO_REF" "packages: catalog" "$OUT"
refute "PRE_COMMIT_TO_REF" "refs must be pushed" "$OUT"
GATE_ENV=(GATE_PROBE=1)
ok "PRE_COMMIT_TO_REF equal to HEAD is gated normally"

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

# 9. The package prefix is a directory, not a string.
new_repo
commit_change feature workers/catalog-extra/x.ts
run_gate < /dev/null
expect_status "sibling dir" 1 "$STATUS"
expect "sibling dir" "no gate covers" "$OUT"
expect "sibling dir" "workers/catalog-extra/x.ts" "$OUT"
expect "sibling dir" "packages: (none)" "$OUT"
new_repo
commit_change feature workers/catalog/x.ts
run_gate < /dev/null
expect_status "sibling dir" 0 "$STATUS"
expect "sibling dir" "packages: catalog" "$OUT"
ok "a sibling directory sharing a package's name prefix selects no package"

[ "$failures" = 0 ] || { printf '%s case(s) failed\n' "$failures" >&2; exit 1; }
printf 'pre-push-affected.test.sh: all green\n'
