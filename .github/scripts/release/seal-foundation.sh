#!/usr/bin/env bash
set -euo pipefail
(cd infra/database-access
  pulumi install --no-dependencies --no-plugins --non-interactive
  git restore package.json
  pnpm install --frozen-lockfile)
mkdir -p release/foundation/infra/database-access/sdks
git archive "$GITHUB_SHA" infra | tar -x -C release/foundation
cp -RL infra/database-access/node_modules/@pulumi/neon release/foundation/infra/database-access/sdks/neon
cp package.json pnpm-lock.yaml pnpm-workspace.yaml .pulumi.version release/foundation/
