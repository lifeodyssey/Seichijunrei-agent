#!/usr/bin/env bash
# Check Atlas before executor publication, then both owners before application mutations.
set -euo pipefail
case "${1:?environment required}" in staging|production) ;; *) exit 1 ;; esac
: "${MIGRATOR_URL:?existing migrator URL required}"
[[ "$MIGRATOR_URL" == https://* ]] || { echo '::error::migrator must use HTTPS'; exit 1; }
head="$(find release/migrations -maxdepth 1 -name '*.sql' -exec basename {} .sql \; | sort | tail -n 1)"
[ -n "$head" ] || { echo '::error::migration chain is empty'; exit 1; }
baseline=false
[ ! -f release/migrations/STAGING_ONLY_BASELINE ] || baseline=true
prisma_ref=''
case "${2:-native}" in
  --atlas-only) ;;
  native) prisma_ref="$(jq -er '.storage.storageHash | select(type == "string" and test("^[a-f0-9]{64}$"))' release/migrator/bundle/contract.json)" ;;
  *) echo '::error::unknown migration preflight mode'; exit 1 ;;
esac
jq -n --arg head "$head" --rawfile sum release/migrations/atlas.sum --argjson baseline "$baseline" --arg prisma "$prisma_ref" \
  '{expectedHead:$head,atlasSum:$sum,stagingOnlyBaseline:$baseline} +
  (if $prisma == "" then {} else {expectedPrismaRef:$prisma} end)' > preflight-request.json
if [ -n "$prisma_ref" ]; then
  # shellcheck source=scripts/delivery/migrator-bundle.sh
  source "$(dirname "${BASH_SOURCE[0]}")/../../../scripts/delivery/migrator-bundle.sh"
  await_migrator_bundle "$head" "$prisma_ref" || { echo '::error::selected migration executor is unavailable'; exit 1; }
fi
token="$(curl --proto '=https' --proto-redir '=https' -sSf --max-time 30 \
  -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=animichi:github-actions:migrator" | jq -er .value)"
request_preflight() {
  curl --proto '=https' --proto-redir '=https' -sS --max-time 60 -o schema-preflight.json -w '%{http_code}' \
    -H "Authorization: Bearer $token" -H 'content-type: application/json' \
    --data-binary @preflight-request.json "${MIGRATOR_URL%/}/preflight"
}
attempt=1
while :; do
  code="$(request_preflight)"
  [ "$code" != 200 ] || break
  if [ -z "$prisma_ref" ] || [ "$code" != 409 ] || ! jq -e '.error == "stale_bundle" or .error == "stale_prisma_bundle"' schema-preflight.json > /dev/null; then
    echo "::error::migration preflight refused or unavailable (HTTP $code)"; exit 1
  fi
  [ "$attempt" -lt "${STALE_BUNDLE_ATTEMPTS:-3}" ] || { echo '::error::native preflight remained on a stale bundle'; exit 1; }
  attempt=$((attempt + 1))
  sleep "${BUNDLE_POLL_SECONDS:-5}"
  await_migrator_bundle "$head" "$prisma_ref" || { echo '::error::selected migration executor is unavailable'; exit 1; }
done
jq -e --arg head "$head" '.compatible == true and .expectedHead == $head
  and (.appliedHead | type == "string" and test("^[0-9]{14}_[a-z0-9_]+$"))
  and (.pendingCount | type == "number" and . >= 0 and . == floor)' schema-preflight.json > /dev/null
if [ -n "$prisma_ref" ]; then
  jq -e --arg target "$prisma_ref" '.prisma | .targetHash == $target and .usedLiveMarker == true
    and (.markerHash | type == "string" and test("^(empty|[a-f0-9]{64})$"))
    and (.migrations | type == "array")
    and ((.migrations | length) > 0 or .markerHash == $target)' schema-preflight.json > /dev/null
fi
