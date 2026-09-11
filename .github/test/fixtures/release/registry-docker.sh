#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> requests
[ "${REGISTRY_EXIT:-0}" = 0 ] || exit "$REGISTRY_EXIT"
[ "$1 $2 $3" = 'buildx imagetools inspect' ]
[ "$5" = --format ]
case "$6" in
  '{{json .Manifest}}') cat manifest.json ;;
  '{{json .Image}}') cat image.json ;;
  *) exit 2 ;;
esac
exit "${REGISTRY_POST_EXIT:-0}"
