#!/usr/bin/env bash
# Refuse a staging-only baseline before production migrates (#1365). A release
# payload whose migration chain was cut for staging alone carries a marker file;
# promoting that payload to production needs a separately approved cutover, so
# this exits 1 — and CD runs it before the production migration step, never
# after, where it would only refuse a cutover that already happened.
#
# Usage: production-baseline-guard.sh <marker-path>
# The marker path is the caller's, resolved against the caller's working
# directory: CD hands it the sealed payload's `release/migrations/…` copy.
set -euo pipefail

MARKER="${1:?marker path is required}"

if [ -f "$MARKER" ]; then
  echo "::error::staging-only baseline requires a separately approved production cutover"
  exit 1
fi
