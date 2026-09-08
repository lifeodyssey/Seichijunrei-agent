#!/usr/bin/env bash
# Re-record `packages/eval/fixtures/captures/` from live staging turns (W3-2 #1300).
#
# The shaper's fixtures are the Python-recorded SD-9 captures today, because
# this card was implemented with no staging credential in reach. Run this once
# the Access service token is to hand to replace them with turns the deployed edge actually
# answered, then re-run `pnpm --filter @animichi/eval test`: the shaper must not
# need a line changed, and if it does, that difference is the finding.
#
# Needs, all fail-closed in the code rather than re-checked here (one door):
#   CATALOG_API_ORIGIN   the staging origin           (workers/edge/api-test/README.md)
#   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET     the Cloudflare Access service token,
#                        both or neither              (workers/edge/api-test/README.md, #1369)
#   NEON_AUTH_BASE_URL   the Neon Auth base URL       (docs/ops/auth-migration-neon.md §4)
#   QA_NEON_USER_EMAIL / QA_NEON_USER_PASSWORD        the QA identity to sign in as
#
# Usage (case names come from the exported dataset):
#   bash packages/eval/scripts/record-captures.sh --dataset agent_eval_heldout_v1 HO_loc_ja_zhq_001
#
# It costs real model time on a shared deployment: record the few cases you mean
# to pin, not a set.
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PACKAGE_DIR"

# NODE_USE_ENV_PROXY mirrors `pnpm --filter edge-worker run test:catalog-api`:
# it lets an operator behind a proxy reach staging at all, and the flag is inert
# when no HTTP_PROXY/HTTPS_PROXY is set.
NODE_USE_ENV_PROXY=1 exec node scripts/record-captures.ts "$@"
