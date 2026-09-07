#!/usr/bin/env bash
# Behavioural tests for bundle-release-worker.sh (card C1 / #1364).
#
# The logic it replaced — the image-reference rewriting inside the retired
# `build-release-unit` composite and `promote-release-unit.sh` — had
# `test_promote_release_unit.sh` behind it. Reading the source and asserting the
# `sed` looks right proves nothing: the defect class here is a substitution that
# matches no line, or matches one line of three, and both leave a config that
# reads correctly and deploys the wrong image. So these run the shipped script
# with a stub `pnpm` standing in for the Wrangler dry run.
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bundle-release-worker.sh"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="registry.cloudflare.com/acct/animichi-agent:sha-deadbeef"
WORKSPACE=""
DRY_RUN_LOG=""

fail() { echo "FAIL: $*" >&2; exit 1; }

# `pnpm exec wrangler deploy -c <cfg> --dry-run -e <env> --outdir <dir>`: record
# the config it was handed, then emit the entry file esbuild would have written.
make_pnpm_stub() {
  mkdir -p "$WORKSPACE/stub-bin"
  cat > "$WORKSPACE/stub-bin/pnpm" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
config=""; outdir=""
while [ $# -gt 0 ]; do
  case "$1" in
    -c) config="$2"; shift 2 ;;
    --outdir) outdir="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cp "$config" "$STUB_CONFIG_COPY"
mkdir -p "$outdir"
[ "${STUB_EMIT_ENTRY:-1}" = 1 ] && printf 'bundled\n' > "$outdir/$STUB_ENTRY"
exit 0
STUB
  chmod +x "$WORKSPACE/stub-bin/pnpm"
}

make_worker() {
  local main="$1"
  mkdir -p "$WORKSPACE/workers/probe/src"
  {
    printf 'name = "probe"\n'
    [ -n "$main" ] && printf 'main = "%s"\n' "$main"
    printf '\n[[containers]]\nimage = "./Dockerfile"\n'
    printf '\n[env.staging]\nimage = "./Dockerfile"\n'
  } > "$WORKSPACE/workers/probe/wrangler.toml"
  printf 'export default {};\n' > "$WORKSPACE/workers/probe/src/index.ts"
}

setup() {
  WORKSPACE="$(mktemp -d)"
  make_pnpm_stub
  make_worker "src/index.ts"
}

teardown() { rm -rf "$WORKSPACE"; }

run_bundler() {
  ( cd "$WORKSPACE"
    PATH="$WORKSPACE/stub-bin:$PATH" \
    STUB_CONFIG_COPY="$WORKSPACE/handed-to-wrangler.toml" \
    STUB_ENTRY="${STUB_ENTRY:-index.js}" \
    STUB_EMIT_ENTRY="${STUB_EMIT_ENTRY:-1}" \
    bash "$SCRIPT" "$@" )
}

test_image_reference_replaces_every_declaration() {
  setup
  run_bundler probe staging "$IMAGE" >/dev/null
  local sealed="$WORKSPACE/release/probe/wrangler.toml"
  [ "$(grep -c "image = \"$IMAGE\"" "$sealed")" = 2 ] ||
    fail "both image declarations must carry the release reference"
  grep -q 'Dockerfile' "$sealed" && fail "no Dockerfile reference may survive in the sealed config"
  teardown
  echo "ok: every image declaration is rewritten"
}

test_no_image_reference_leaves_the_config_untouched() {
  setup
  run_bundler probe staging >/dev/null
  cmp -s "$WORKSPACE/workers/probe/wrangler.toml" "$WORKSPACE/release/probe/wrangler.toml" ||
    fail "a Worker without an image must ship its config byte-identical"
  teardown
  echo "ok: an imageless Worker ships its config unchanged"
}

# The dry run reads a config outside the Worker directory, so its `main` has to
# be absolute — while the sealed config keeps the repository-relative one, which
# the stage jobs override positionally.
test_build_config_is_absolute_and_the_sealed_one_is_not() {
  setup
  run_bundler probe staging "$IMAGE" >/dev/null
  grep -q "^main = \"$WORKSPACE/workers/probe/src/index.ts\"$" "$WORKSPACE/handed-to-wrangler.toml" ||
    fail "the config handed to wrangler must carry an absolute main"
  grep -q '^main = "src/index.ts"$' "$WORKSPACE/release/probe/wrangler.toml" ||
    fail "the sealed config must keep its repository-relative main"
  teardown
  echo "ok: the build config is rebased, the sealed config is not"
}

test_missing_entry_point_fails_closed() {
  setup
  local rc=0
  STUB_EMIT_ENTRY=0 run_bundler probe staging "$IMAGE" >"$WORKSPACE/out" 2>&1 || rc=$?
  [ "$rc" != 0 ] || fail "a bundle without its entry point must not be sealed"
  grep -q 'has no index.js entry point' "$WORKSPACE/out" || fail "the failure must name the missing entry"
  teardown
  echo "ok: a missing entry point fails closed"
}

test_config_without_main_fails_closed() {
  setup
  make_worker ""
  local rc=0
  run_bundler probe staging "$IMAGE" >"$WORKSPACE/out" 2>&1 || rc=$?
  [ "$rc" != 0 ] || fail "a config declaring no main must not be sealed"
  grep -q 'declares no main module' "$WORKSPACE/out" || fail "the failure must name the missing main"
  teardown
  echo "ok: a config with no main fails closed"
}

# Everything above stubs `pnpm`, and a stub honours `--outdir` against its own
# working directory. Real Wrangler does not: it resolves the flag against the
# directory holding the config file, which `build_config` puts in `mktemp -d` —
# so a relative outdir wrote the bundle under the scratch directory and left only
# Wrangler's own README under `release/<unit>`, and every stubbed case above
# stayed green while CD failed the entry check. Only the real dry run can see
# that, so this case runs it: catalog, at the repository root, no network.
#
# It is last, and its cleanup is an EXIT trap, because it is the only case that
# writes outside a `mktemp -d` workspace: it builds into `release/` at the
# repository root, and refuses to start if that directory already exists. So two
# runs of this file in one worktree collide, and every pre-push pays for one real
# Wrangler build.
test_the_real_dry_run_writes_its_entry_into_the_release_tree() {
  [ -e "$REPO_ROOT/release" ] && fail "release/ already exists; refusing to run over it"
  DRY_RUN_LOG="$(mktemp)"
  trap 'rm -rf "$REPO_ROOT/release" "$DRY_RUN_LOG"' EXIT
  local rc=0
  ( cd "$REPO_ROOT" && bash "$SCRIPT" catalog production ) >"$DRY_RUN_LOG" 2>&1 || rc=$?
  # Checked before the entry file, so a Wrangler or node crash reports itself
  # rather than surfacing as the missing-entry defect this case exists to catch.
  [ "$rc" = 0 ] || fail "the bundler exited $rc -- $(tail -n 1 "$DRY_RUN_LOG")"
  [ -s "$REPO_ROOT/release/catalog/bundle/index.js" ] ||
    fail "release/catalog/bundle/index.js is missing or empty -- $(tail -n 1 "$DRY_RUN_LOG")"
  [ -f "$REPO_ROOT/release/catalog/wrangler.toml" ] ||
    fail "the sealed config must ship beside the bundle it deploys"
  echo "ok: the real wrangler dry run writes its entry into the release tree"
}

test_image_reference_replaces_every_declaration
test_no_image_reference_leaves_the_config_untouched
test_build_config_is_absolute_and_the_sealed_one_is_not
test_missing_entry_point_fails_closed
test_config_without_main_fails_closed
test_the_real_dry_run_writes_its_entry_into_the_release_tree
echo "All bundle-release-worker.sh behavioural tests passed."
