#!/usr/bin/env bash
# Root-directory hygiene gate (S0-v2 Track A.3): the repo root is locked to an
# explicit allowlist. Every top-level entry `git ls-files` reports (first path
# segment, dot-entries included) must appear in ALLOWED_ROOT_ENTRIES below —
# anything else fails the gate, so a new top-level file or directory requires
# a conscious allowlist edit instead of silently drifting in.
set -euo pipefail

# Explicit allowlist of tracked top-level entries, kept sorted. Dot-entries
# (.github, .gitignore, ...) are included by design.
ALLOWED_ROOT_ENTRIES=(
  .claude
  .codacy.yml
  .dockerignore
  .env.example
  .env.test.example
  .github
  .gitleaks.toml
  .gitignore
  .npmrc
  .nvmrc
  .oxlintrc.json
  .pre-commit-config.yaml
  .pulumi.version
  .semgrep
  .semgrepignore
  .serena
  .sonarcloud.properties
  .sqlfluff
  AGENTS.md
  CLAUDE.md
  CONTEXT-MAP.md
  Makefile
  README.ja.md
  README.md
  README.zh.md
  apps
  codecov.yml
  commitlint.config.js
  db
  docker
  docs
  e2e
  fixtures
  infra
  migrations
  package.json
  packages
  pnpm-lock.yaml
  pnpm-workspace.yaml
  recovery
  scripts
  supabase
  workers
)

# First path segment of every tracked file; -z keeps non-ASCII paths unquoted.
list_root_entries() {
  git -c core.quotepath=false ls-files -z | while IFS= read -r -d '' file; do
    printf '%s\n' "${file%%/*}"
  done | sort -u
}

main() {
  local entry unexpected=0
  cd "$(git rev-parse --show-toplevel)"
  while IFS= read -r entry; do
    if ! [[ " ${ALLOWED_ROOT_ENTRIES[*]} " == *" ${entry} "* ]]; then
      echo "top-level entry not in allowlist: ${entry}"
      unexpected=1
    fi
  done < <(list_root_entries)
  if [ "${unexpected}" -ne 0 ]; then
    echo "add unexpected entries to ALLOWED_ROOT_ENTRIES in ${0##*/} or move them out of the repo root"
    exit 1
  fi
  echo "all top-level entries are allowlisted"
}

main
