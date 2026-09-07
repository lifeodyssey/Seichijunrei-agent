#!/bin/sh
# #1051/#1100 — one-shot Atlas apply to head.
#
# The worker injects MIGRATOR_DATABASE_URL only for the seconds this container
# runs. Connect fail-fast: reject a -pooler (PgBouncer) endpoint
# case-insensitively, keep the DSN host as a domain (IPv4 pin strips TLS SNI
# and Neon cannot route), append connect_timeout + search_path=public, run
# `atlas migrate status` with a 30s connect bound and apply only when it
# succeeds. Nothing here echoes the DSN / URL / password; logs are secret-free.
set -eu

# shellcheck source=workers/migrator/docker/dsn.sh
. "$(dirname "$0")/dsn.sh"

DSN="${MIGRATOR_DATABASE_URL:?MIGRATOR_DATABASE_URL is required}"

HOST="$(dsn_host "$DSN")"
dsn_reject_pooler "$HOST"

SCOPE="$(append_query "$DSN" "connect_timeout=$PROBE_SECS")"
SCOPE="$(append_query "$SCOPE" "search_path=public")"

echo "probe: start"
probe_start="$(date +%s)"
if run_probe "file:///migrations" "$SCOPE"; then
  probe_end="$(date +%s)"
  echo "probe: elapsed_ms=$(((probe_end - probe_start) * 1000)) ok"
else
  probe_code=$?
  probe_end="$(date +%s)"
  echo "probe: elapsed_ms=$(((probe_end - probe_start) * 1000)) fail code=$probe_code"
  exit "$probe_code"
fi

apply_chain "file:///migrations" "$SCOPE"
