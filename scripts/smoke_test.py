"""Minimal offline smoke test (no external API calls).

This script verifies the repo is importable and the ADK agent wiring is valid.
It intentionally does NOT call any LLMs or external HTTP APIs.
"""

from __future__ import annotations

import asyncio
import json

from health import startup_check


def main() -> int:
    result = asyncio.run(startup_check())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("startup_status") == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
