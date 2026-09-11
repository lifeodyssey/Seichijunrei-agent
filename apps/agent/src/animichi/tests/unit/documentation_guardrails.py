"""Executable checks for canonical documentation drift."""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[6]
HISTORICAL_MARKER = "<!-- historical: retired in #537 -->"

_HYGIENE_DOCS = (Path("docs/ARCHITECTURE.md"), Path("docs/ops/deployment.md"))
_RETIRED_TECHNOLOGY = re.compile(r"\b(?:Next\.js|OpenNext|Mapbox)\b", re.I)
_DOCUMENTED_COVERAGE = re.compile(
    r"^\| (Backend total|Frontend (?:statements|branches|functions|lines)) "
    r"\| `(\d+)` \|",
    re.MULTILINE,
)
_BACKEND_COVERAGE = re.compile(r"--cov-fail-under=(\d+)")
_FRONTEND_BLOCK = re.compile(r"thresholds:\s*\{([^}]*)\}")
_FRONTEND_COVERAGE = re.compile(r"(statements|branches|functions|lines):\s*(\d+)")
_COVERAGE_KEYS = frozenset(
    {
        "Backend total",
        "Frontend statements",
        "Frontend branches",
        "Frontend functions",
        "Frontend lines",
    }
)
_AGENT_RUNTIME_HEADING = "## Request and execution"
_AGENT_RUNTIME_FACTS = (
    "AgentHarness",
    "AgentLane",
    "registers durable recovery before",
    "inspectExecution/getResult",
    "Native Pi owns",
    "Shared production/Eval composition",
    "There is no compatibility converter",
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _paragraphs(text: str) -> tuple[str, ...]:
    return tuple(part for part in re.split(r"\n\s*\n", text) if part)


def _unmarked_retired_technologies(text: str) -> tuple[str, ...]:
    return tuple(
        match.group(0)
        for paragraph in _paragraphs(text)
        if HISTORICAL_MARKER not in paragraph
        for match in _RETIRED_TECHNOLOGY.finditer(paragraph)
    )


def assert_retired_technologies_are_historical(
    text: str, source: str = "document"
) -> None:
    unmarked = _unmarked_retired_technologies(text)
    if not unmarked:
        return
    raise ValueError(f"{source}: unmarked retired technology: {', '.join(unmarked)}")


def check_retired_technology_docs(repo_root: Path) -> None:
    for relative_path in _HYGIENE_DOCS:
        assert_retired_technologies_are_historical(
            _read(repo_root / relative_path), str(relative_path)
        )


def _coverage_key_drift(values: dict[str, int]) -> str:
    missing = sorted(_COVERAGE_KEYS.difference(values))
    unexpected = sorted(values.keys() - _COVERAGE_KEYS)
    parts = []
    if missing:
        parts.append(f"missing {', '.join(missing)}")
    if unexpected:
        parts.append(f"unexpected {', '.join(unexpected)}")
    return "; ".join(parts)


def _require_coverage_keys(values: dict[str, int], source: str) -> dict[str, int]:
    if values.keys() == _COVERAGE_KEYS:
        return values
    raise ValueError(
        f"{source}: coverage threshold keys drifted: {_coverage_key_drift(values)}"
    )


def documented_coverage_thresholds(repo_root: Path) -> dict[str, int]:
    text = _read(repo_root / "docs/testing-strategy.md")
    values = {name: int(value) for name, value in _DOCUMENTED_COVERAGE.findall(text)}
    return _require_coverage_keys(values, "docs/testing-strategy.md")


def _backend_coverage_threshold(repo_root: Path) -> int:
    text = _read(repo_root / "apps/agent/pyproject.toml")
    match = _BACKEND_COVERAGE.search(text)
    if match is None:
        raise ValueError(
            "apps/agent/pyproject.toml: backend coverage threshold missing"
        )
    return int(match.group(1))


def _frontend_coverage_thresholds(repo_root: Path) -> dict[str, int]:
    text = _read(repo_root / "apps/web/vitest.config.ts")
    match = _FRONTEND_BLOCK.search(text)
    if match is None:
        raise ValueError("apps/web/vitest.config.ts: coverage thresholds missing")
    return {
        f"Frontend {name}": int(value)
        for name, value in _FRONTEND_COVERAGE.findall(match.group(1))
    }


def live_coverage_thresholds(repo_root: Path) -> dict[str, int]:
    values = {"Backend total": _backend_coverage_threshold(repo_root)}
    values.update(_frontend_coverage_thresholds(repo_root))
    return _require_coverage_keys(values, "live coverage configs")


def extract_agent_runtime_section(architecture: str) -> str:
    start = architecture.find(_AGENT_RUNTIME_HEADING)
    if start < 0:
        raise ValueError("docs/ARCHITECTURE.md: agent-runtime section missing")
    section = architecture[start:]
    end = section.find("\n## ", len(_AGENT_RUNTIME_HEADING))
    return section if end < 0 else section[:end]


def _check_agent_runtime(repo_root: Path) -> None:
    section = extract_agent_runtime_section(_read(repo_root / "docs/ARCHITECTURE.md"))
    missing = tuple(fact for fact in _AGENT_RUNTIME_FACTS if fact not in section)
    if missing:
        raise ValueError(
            f"docs/ARCHITECTURE.md: agent-runtime facts missing: {', '.join(missing)}"
        )


def check_repository_documentation(repo_root: Path = REPO_ROOT) -> None:
    check_retired_technology_docs(repo_root)
    if documented_coverage_thresholds(repo_root) != live_coverage_thresholds(repo_root):
        raise ValueError("docs/testing-strategy.md: coverage thresholds drifted")
    _check_agent_runtime(repo_root)


def main() -> int:
    check_repository_documentation()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
