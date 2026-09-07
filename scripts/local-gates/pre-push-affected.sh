#!/usr/bin/env bash
# The pre-push gate (#1371). git names the changed files, `pnpm ls` names the
# project directories, and a prefix join selects the packages: pnpm's own
# `[<ref>]` selector answers nothing from a worktree nested inside the repo
# (pnpm/pnpm#12626). Buckets, whitelist, rationale: docs/ops/local-gates.md.
set -euo pipefail
unset "${!GIT_@}"
cd "$(git rev-parse --show-toplevel)"

NO_PACKAGE='^(docs/|\.claude/|\.github/|\.semgrep|scripts/|codecov\.yml$|\.pre-commit-config\.yaml$|Makefile$|[^/]+\.md$)'
ROOT_MANIFEST='^(pnpm-lock\.yaml|package\.json|pnpm-workspace\.yaml|\.npmrc)$'
changed="$(git diff --name-only --no-renames "$(git merge-base origin/main HEAD)"...HEAD)"
[ -n "$changed" ] || exit 0
deps=$(grep -cE "$ROOT_MANIFEST" <<<"$changed" || true)
projects="$(pnpm ls -r --depth -1 --json | jq -r --arg root "$PWD/" '
  .[] | select(.name != "animichi-cloudflare-worker" and .name != "@animichi/agent")
      | "\(.path | ltrimstr($root))/ \(.name)"')"
packages=""
while read -r dir name; do
  [ -n "$dir" ] || continue  # an empty $projects still yields one blank line
  if [ "$deps" != 0 ] || grep -q "^$dir" <<<"$changed"; then packages="$packages $name"; fi
done <<<"$projects"
agent=$(grep -cE '^(apps/agent|packages/contract)/' <<<"$changed" || true)
schema=$(grep -cE '^migrations/neon/' <<<"$changed" || true)
docs=$(grep -cE '^(docs/|\.claude/|[^/]+\.md$)' <<<"$changed" || true)
printf 'pre-push: packages:%s | agent=%s schema=%s deps=%s docs=%s\n' "${packages:- (none)}" "$agent" "$schema" "$deps" "$docs"
# Nothing selected it, no bucket owns it, and no whitelist entry excuses it.
if [ -z "$packages" ] && [ "$agent" = 0 ] && [ "$schema" = 0 ]; then
  loose="$(grep -vE "$NO_PACKAGE" <<<"$changed" || true)"
  [ -z "$loose" ] || { printf 'pre-push: no gate covers:\n%s\n' "$loose" >&2; exit 1; }
fi
closure="..."; [ "$deps" = 0 ] || closure=""  # every package is already selected
for name in $packages; do
  for script in lint typecheck test test:integration; do
    pnpm -r --filter "$closure$name" run --if-present "$script"
  done
done
[ "$agent" = 0 ] || make check
[ "$schema" = 0 ] || atlas migrate validate --dir file://migrations/neon
[ "$docs" = 0 ] || for c in agents-refs docs-paths root-allowlist; do bash "scripts/local-gates/check-$c.sh"; done
