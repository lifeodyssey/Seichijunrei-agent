#!/usr/bin/env bash
# Pre-commit oxlint for the staged workspace packages (#1113).
# The selection is the pre-push gate's, read against the staged diff instead of
# the branch: git names the files, `pnpm ls` names the project directories, and
# a prefix join picks the packages. #1371 retired the two routers this used to
# source; pnpm's own `[<ref>]` selector cannot replace them, because it answers
# nothing from a worktree nested inside the repo (pnpm/pnpm#12626).
# --no-renames lists both sides of a rename, so a cross-package move lints the
# source package too.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

staged="$(git diff --cached --name-only --no-renames)"
[ -n "$staged" ] || exit 0

projects="$(pnpm ls -r --depth -1 --json | jq -r --arg root "$PWD/" '
  .[] | select(.name != "animichi-cloudflare-worker")
      | "\(.path | ltrimstr($root))/ \(.name)"')"

# Every workspace package has a lint:oxlint script (#1358) except the Python
# agent, so the script's presence is the filter rather than a package list.
while read -r dir name; do
  if grep -q "^$dir" <<<"$staged" && grep -q '"lint:oxlint"' "$dir/package.json"; then
    pnpm --filter "$name" run lint:oxlint
  fi
done <<<"$projects"
