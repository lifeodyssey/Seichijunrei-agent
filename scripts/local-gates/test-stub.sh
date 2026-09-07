#!/usr/bin/env bash
# Universal tool stub for local-gate behavioral tests.
#
# Records every invocation to $GATE_TEST_LOG as "PWD :: argv", logs the
# VITE_SHOWCASE_MODE environment for pnpm invocations (the web build gate
# depends on it), fakes the few commands the gates parse (docker run/port,
# pulumi preview classification), and exits 1 for any invocation matching
# $GATE_FAIL_ON so tests can exercise fail-fast propagation. Dedicated env
# switches simulate the fail-closed prerequisite conditions the gates must
# detect: GATE_DOCKER_UNAVAILABLE (daemon down), GATE_DOCKER_IMAGE_MISSING,
# GATE_PULUMI_INIT_FAIL, GATE_PULUMI_COMPILE_FAIL (loader/compiler error),
# GATE_PULUMI_UNKNOWN_FAIL (nonzero preview with an unrecognized error),
# GATE_PULUMI_WARN_FAIL (rendered plan + allowlisted noise + an unknown
# warning), GATE_PULUMI_CAP_ERROR_FAIL (rendered plan + capitalized Error:),
# GATE_PULUMI_TYPEERROR_FAIL (rendered plan + TypeError:), GATE_PULUMI_PLAIN_FAIL
# (rendered plan + unknown plain text), GATE_PULUMI_PLAN_ONLY_FAIL (rendered
# plan with no diagnostic at all), GATE_PULUMI_UNAUTHORIZED_ALLOWED (rendered
# plan + a complete indented `error: Unauthorized` line),
# GATE_PULUMI_UNAUTHORIZED_UNKNOWN (rendered plan + `error: Unauthorized:
# unrelated runtime failure` — a trailing `: ...` after unauthorized is NOT
# allowlisted), and GATE_PULUMI_UNAUTHORIZED_MIXED (rendered plan + allowlisted
# noise + the COMPACT `error:Unauthorized:unrelated-runtime-failure` — a PLAN_RE
# `a:b:c` resource-row form the classifier must keep red via
# is_unknown_diagnostic, the fail-open hole), and GATE_PULUMI_NO_NL (rendered
# plan + allowlisted noise + a final `error:Unauthorized:no-nl` printed with
# no trailing newline — a read-EOF line the classifier must still process).
# GATE_PULUMI_CLEAN makes preview print a rendered plan and exit 0 (the gate's
# green path). The default pulumi preview
# emission is the
# allowed-noise case: a rendered plan line plus credential/provider noise,
# exiting nonzero.
#
# A `pnpm exec wrangler deploy --dry-run --outdir <dir>` invocation also emits
# the bundle that dry run would have written; see emit_wrangler_bundle below.
#
# `node -v` and `atlas version` are SILENT probes: check_prereqs runs them on
# every gate run, and the invocation log must stay the record of GATES that
# ran (tests assert_lacks "atlas"/"pulumi" on it). They exit 0, printing the
# pinned-compliant versions unless GATE_NODE_OLD=1 / GATE_ATLAS_OLD=1 ask for
# the documented-mismatch versions.
set -u

log() { printf '%s :: %s %s\n' "$PWD" "$(basename "$0")" "$*" >> "${GATE_TEST_LOG:?}"; }

flag_value() {
  local flag="$1"; shift
  while [ "$#" -gt 1 ]; do
    [ "$1" = "$flag" ] && { printf '%s\n' "$2"; return 0; }
    shift
  done
}

# Emit what `wrangler deploy --dry-run --outdir <dir>` leaves behind: the entry
# esbuild names after the config's `main`, plus Wrangler's own README.
#
# `<dir>` is honoured EXACTLY as given, and must stay that way. Real Wrangler
# resolves a *relative* outdir against the config's directory (esbuild
# `absWorkingDir`), which is the bug .github/scripts/bundle-release-worker.sh
# was sealed against; teaching this stub that quirk would hide it again.
emit_wrangler_bundle() {
  local config outdir main
  config="$(flag_value -c "$@")"
  outdir="$(flag_value --outdir "$@")"
  [ -n "$config" ] && [ -n "$outdir" ] || return 0
  main="$(sed -n 's/^main = "\(.*\)"$/\1/p' "$config")"
  [ -n "$main" ] || return 0
  mkdir -p "$outdir"
  printf 'bundled\n' > "$outdir/$(basename "${main%.ts}").js"
  printf 'built output assets stub\n' > "$outdir/README.md"
}

tool="$(basename "$0")"
case "$tool:$*" in
  node:-v*)
    if [ "${GATE_NODE_OLD:-}" = "1" ]; then
      printf 'v20.0.0\n'
    elif [ "${GATE_NODE_MALFORMED:-}" = "1" ]; then
      printf 'vunknown\n'
    else
      printf 'v24.0.0\n'
    fi
    exit 0 ;;
  atlas:version*)
    if [ "${GATE_ATLAS_OLD:-}" = "1" ]; then
      printf 'atlas version v0.29.9\n'
    else
      printf 'atlas version v0.30.0\n'
    fi
    exit 0 ;;
esac

log "$@"
case "$tool:$*" in
  pnpm:*)
    printf 'env VITE_SHOWCASE_MODE=%s\n' "${VITE_SHOWCASE_MODE:-}" >> "${GATE_TEST_LOG:?}"
    case "$*" in
      "exec wrangler deploy"*--dry-run*--outdir*) emit_wrangler_bundle "$@" ;;
    esac ;;
  pulumi:stack\ init*) [ "${GATE_PULUMI_INIT_FAIL:-}" = "1" ] && exit 1 ;;
  pulumi:preview*)
    if [ "${GATE_PULUMI_CLEAN:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf '+   pulumi:pulumi:Stack seichijunrei-infra create\n' >&2
      exit 0
    fi
    if [ "${GATE_PULUMI_COMPILE_FAIL:-}" = "1" ]; then
      printf 'error: TSError: failed to compile the infra program\n' >&2
    elif [ "${GATE_PULUMI_UNKNOWN_FAIL:-}" = "1" ]; then
      printf 'error: matrix core has been compromised\n' >&2
    elif [ "${GATE_PULUMI_CAP_ERROR_FAIL:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'Error: the matrix core has been compromised\n' >&2
    elif [ "${GATE_PULUMI_TYPEERROR_FAIL:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'TypeError: cannot read properties of undefined\n' >&2
    elif [ "${GATE_PULUMI_PLAIN_FAIL:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'the matrix core has been compromised\n' >&2
    elif [ "${GATE_PULUMI_PLAN_ONLY_FAIL:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf '+   pulumi:pulumi:Stack seichijunrei-infra create\n' >&2
    elif [ "${GATE_PULUMI_WARN_FAIL:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'error: Missing API token for cloudflare\n' >&2
      printf 'warning: plugin has a newer version available\n' >&2
    elif [ "${GATE_PULUMI_UNAUTHORIZED_ALLOWED:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf '  error: Unauthorized\n' >&2
    elif [ "${GATE_PULUMI_UNAUTHORIZED_UNKNOWN:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'error: Unauthorized: unrelated runtime failure\n' >&2
    elif [ "${GATE_PULUMI_UNAUTHORIZED_MIXED:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'error: Missing API token for cloudflare\n' >&2
      printf 'error:Unauthorized:unrelated-runtime-failure\n' >&2
    elif [ "${GATE_PULUMI_NO_NL:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'error: Missing API token for cloudflare\n' >&2
      printf 'error:Unauthorized:no-nl' >&2
    else
      printf 'Previewing update (preflight):\n'
      printf 'error: Missing API token for cloudflare\n' >&2
    fi
    exit 1 ;;
  docker:info*) [ "${GATE_DOCKER_UNAVAILABLE:-}" = "1" ] && exit 1 ;;
  docker:exec*pg_isready*) [ "${GATE_DOCKER_TCP_UNAVAILABLE:-}" = "1" ] && exit 1 ;;
  docker:run*) printf 'gate-cid\n' ;;
  docker:port*) printf '0.0.0.0:5433\n' ;;
  "docker:image inspect"*) [ "${GATE_DOCKER_IMAGE_MISSING:-}" = "1" ] && exit 1 ;;
esac
if [ -n "${GATE_FAIL_ON:-}" ]; then
  case "$*" in
    *"$GATE_FAIL_ON"*) exit 1 ;;
  esac
fi
exit 0
