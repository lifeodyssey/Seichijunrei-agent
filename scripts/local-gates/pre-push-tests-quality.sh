#!/usr/bin/env bash
# Quality-lane regression tests for scripts/local-gates/quality.sh — sourced
# by pre-push.test.sh (the single entry point); not standalone.
#
# Covers the ruby -c syntax lane: CI's local static-quality action runs `ruby -c`
# once per Ruby script, and the gate mirrors that — a single `ruby -c a b c`
# would only ever check the first path and silently skip every later file.
# The regression drives the REAL quality.sh from a deterministic temp tree
# that is missing the LAST Ruby path: the gate must fail fast and name the
# missing path.
copy_quality_tree() {
  local dst="$1"
  mkdir -p "$dst/.github/scripts"
  cp -R "$REPO_ROOT/.github/scripts/." "$dst/.github/scripts/"
  rm -f "$dst/.github/scripts/test_package_test_segments.rb"
}

run_quality_in() {
  local dir="$1" rc=0
  (
    cd "$dir"
    PATH="$GATE_STUB_BIN:$PATH" bash "$SCRIPT_DIR/quality.sh"
  ) >"$GATE_STUB_ROOT/quality.out" 2>&1 || rc=$?
  echo "$rc"
}

assert_later_path_named() {
  grep -q "test_package_test_segments.rb" "$GATE_STUB_ROOT/quality.out" || {
    echo "FAIL: the failure must name the missing later path" >&2
    cat "$GATE_STUB_ROOT/quality.out" >&2
    exit 1
  }
}

test_missing_later_ruby_file_fails() {
  local tmp rc
  tmp="$(mktemp -d)"
  copy_quality_tree "$tmp"
  rc="$(run_quality_in "$tmp")" || true
  rm -rf "$tmp"
  [ "$rc" != "0" ] || { echo "FAIL: a nonexistent later Ruby path must fail the quality lane" >&2; exit 1; }
  assert_later_path_named
  echo "ok: quality fails fast when a later Ruby path is missing"
}
