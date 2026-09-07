#!/usr/bin/env bash
# The pre-push gate (#1371). git names the changed files, `pnpm ls` names the
# project directories, and a prefix join selects the packages: pnpm's own
# `[<ref>]` selector answers nothing from a worktree nested inside the repo
# (pnpm/pnpm#12626). Buckets, whitelist, rationale: docs/ops/local-gates.md.
set -euo pipefail
unset "${!GIT_@}"
cd "$(git rev-parse --show-toplevel)"

NO_PACKAGE='^(docs/|\.claude/|\.github/|\.semgrep|scripts/|codecov\.yml$|\.pre-commit-config\.yaml$|commitlint\.config\.js$|Makefile$|[^/]+\.md$)'
ROOT_MANIFEST='^(pnpm-lock\.yaml|package\.json|pnpm-workspace\.yaml|\.npmrc)$'
ZERO=0000000000000000000000000000000000000000

# What is gated is HEAD's diff, and the pushed refs are read to prove that is
# the right thing to gate. git feeds the hook one
# `<local ref> <local sha> <remote ref> <remote sha>` record per ref; pre-commit's
# wrapper eats that stdin and re-exports the first pushable one as
# PRE_COMMIT_{TO,FROM}_REF, so read stdin when there is any and fall back to the
# variables (`[ -t 0 ]` keeps a by-hand terminal run from blocking on a read that
# never arrives). Pushing a ref that is not HEAD is refused rather than gated:
# the paths would come from that ref while `pnpm ls` and every package script ran
# against the checked-out tree, so a broken change could pass on someone else's
# green. This repository is one worktree per card, so the rule costs nothing.
head_sha="$(git rev-parse HEAD)"
base="$(git merge-base origin/main HEAD)"
records=""
[ -t 0 ] || records="$(cat)"
[ -n "$records" ] || records="PRE_COMMIT_TO_REF ${PRE_COMMIT_TO_REF:-$head_sha} _ ${PRE_COMMIT_FROM_REF:-$ZERO}"
while read -r local_ref local_sha _ remote_sha; do
  { [ -n "$local_sha" ] && [ "$local_sha" != "$ZERO" ]; } || continue  # a deletion pushes no content
  [ "$local_sha" = "$head_sha" ] || { printf 'pre-push: refs must be pushed from their own worktree (HEAD is %s, pushing %s@%s)\n' "$head_sha" "$local_ref" "$local_sha" >&2; exit 1; }
  # A remote sha already in this history is the tighter base: only what is new.
  ! git merge-base --is-ancestor "${remote_sha:-$ZERO}" HEAD 2>/dev/null || base="$remote_sha"
done <<<"$records"
changed="$(git diff --name-only --no-renames "$base"...HEAD)"
[ -n "$changed" ] || exit 0

deps=$(grep -cE "$ROOT_MANIFEST" <<<"$changed" || true)
projects="$(pnpm ls -r --depth -1 --json | jq -r --arg root "$PWD/" '
  .[] | select(.name != "animichi-cloudflare-worker" and .name != "@animichi/agent")
      | "\(.path | ltrimstr($root))/ \(.name)"')"
packages=""; covered="$NO_PACKAGE"
while read -r dir name; do
  [ -n "$dir" ] || continue  # an empty $projects still yields one blank line
  if [ "$deps" != 0 ] || grep -q "^$dir" <<<"$changed"; then packages="$packages $name"; covered="$covered|^$dir"; fi
done <<<"$projects"
agent=$(grep -cE '^(apps/agent|packages/contract)/' <<<"$changed" || true)
schema=$(grep -cE '^migrations/neon/' <<<"$changed" || true)
docs=$(grep -cE '^(docs/|\.claude/|[^/]+\.md$)' <<<"$changed" || true)
printf 'pre-push: packages:%s | agent=%s schema=%s deps=%s docs=%s\n' "${packages:- (none)}" "$agent" "$schema" "$deps" "$docs"

# Every changed path must be owned by a selected package, a bucket that fired or
# the whitelist. Checked over the whole diff, so a mixed one cannot carry an
# unowned path through on the strength of its other half.
[ "$deps" = 0 ] || covered="$covered|$ROOT_MANIFEST"
[ "$agent" = 0 ] || covered="$covered|^(apps/agent|packages/contract)/"
[ "$schema" = 0 ] || covered="$covered|^migrations/neon/"
loose="$(grep -vE "$covered" <<<"$changed" || true)"
[ -z "$loose" ] || { printf 'pre-push: no gate covers:\n%s\n' "$loose" >&2; exit 1; }
closure="..."; [ "$deps" = 0 ] || closure=""  # every package is already selected
for name in $packages; do
  for script in lint typecheck test test:integration; do
    pnpm -r --filter "$closure$name" run --if-present "$script"
  done
done
[ "$agent" = 0 ] || make check
[ "$schema" = 0 ] || atlas migrate validate --dir file://migrations/neon
[ "$docs" = 0 ] || for c in agents-refs docs-paths root-allowlist; do bash "scripts/local-gates/check-$c.sh"; done
