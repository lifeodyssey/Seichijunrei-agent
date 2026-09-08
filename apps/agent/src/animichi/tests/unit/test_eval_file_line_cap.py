"""The 1-10-50 file cap, made machine-checkable for the eval package (#1493).

Seven of its modules had drifted past 300 lines with nothing to notice, because
neither `ruff` nor the TypeScript side's oxlint config carries a `max-lines`
rule. This test is the missing gate. Its scope is deliberately one package: the
rest of `apps/agent` still has files over the cap, and a gate that starts red is
a gate nobody can keep — widening it is #1519.
"""

from __future__ import annotations

from pathlib import Path

FILE_LINE_CAP = 300
EVAL_PACKAGE = Path(__file__).resolve().parents[1] / "eval"


def _line_counts() -> dict[str, int]:
    return {
        path.relative_to(EVAL_PACKAGE).as_posix(): len(path.read_text().splitlines())
        for path in sorted(EVAL_PACKAGE.rglob("*.py"))
    }


def _over_cap() -> dict[str, int]:
    return {
        name: lines for name, lines in _line_counts().items() if lines > FILE_LINE_CAP
    }


def test_the_cap_is_measured_against_the_real_eval_modules() -> None:
    assert _line_counts()


def test_every_eval_module_stays_within_the_file_line_cap() -> None:
    assert _over_cap() == {}
