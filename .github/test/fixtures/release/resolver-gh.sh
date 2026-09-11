#!/usr/bin/env bash
set -euo pipefail
root="$(dirname "$0")"
case "${@: -1}" in
  repos/lifeodyssey/animichi/actions/artifacts/7) cat "$root/artifact.json" ;;
  repos/lifeodyssey/animichi/actions/runs/9/attempts/1) cat "$root/run.json" ;;
  repos/lifeodyssey/animichi/actions/workflows/13) cat "$root/workflow.json" ;;
  *) echo 'unexpected or latest-attempt request' >&2; exit 1 ;;
esac
exit "${GH_EXIT:-0}"
