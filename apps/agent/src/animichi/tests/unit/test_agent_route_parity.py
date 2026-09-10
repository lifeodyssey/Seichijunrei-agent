"""Agent OpenAPI/runtime route parity (issue #1005 AC1).

Three representations of the Python-owned Agent protocol must agree exactly.
Native edge-only routes remain in OpenAPI and have their own gateway tests:
 1. the committed generated OpenAPI document
    (packages/contract/agent-openapi.json, emitted from AGENT_PATHS);
 2. the generated Python inventory (AGENT_PATH_INVENTORY in agent_models.py);
 3. the operations FastAPI itself generates from the mounted runtime routers
    (`app.openapi()`), which reflect every mounted APIRoute and exclude the
    framework's own doc surface (/openapi.json, /docs, /redoc).
"""

from __future__ import annotations

import json
from pathlib import Path

from animichi.interfaces.boundary.agent_models import AGENT_PATH_INVENTORY
from animichi.tests.unit.conftest_fastapi import build_app

_REPO_ROOT = Path(__file__).resolve().parents[6]
_AGENT_OPENAPI_PATH = _REPO_ROOT / "packages" / "contract" / "agent-openapi.json"
_AGENT_METHODS = frozenset({"get", "post", "patch"})


def _spec_operations(spec: object) -> list[tuple[str, str]]:
    assert isinstance(spec, dict)
    paths_obj = spec.get("paths")
    assert isinstance(paths_obj, dict)
    operations: list[tuple[str, str]] = []
    for path, item in paths_obj.items():
        operations.extend(_operations_in_path(path, item))
    return sorted(operations)


def _operations_in_path(path: object, item: object) -> list[tuple[str, str]]:
    assert isinstance(path, str)
    assert isinstance(item, dict)
    methods = item.keys() & _AGENT_METHODS
    return [(method.upper(), path) for method in methods]


def _generated_operations() -> list[tuple[str, str]]:
    spec = json.loads(_AGENT_OPENAPI_PATH.read_text(encoding="utf8"))
    return sorted(
        (method.upper(), path)
        for path, item in spec["paths"].items()
        for method, operation in item.items()
        if method in _AGENT_METHODS and operation.get("x-runtime") != "edge"
    )


def _inventory_operations() -> list[tuple[str, str]]:
    return sorted((method, path) for method, path, _summary in AGENT_PATH_INVENTORY)


def _mounted_operations() -> list[tuple[str, str]]:
    app, _ = build_app()
    return _spec_operations(app.openapi())


def test_mounted_routes_equal_generated_openapi() -> None:
    assert _mounted_operations() == _generated_operations()


def test_mounted_routes_equal_python_inventory() -> None:
    assert _mounted_operations() == _inventory_operations()


def test_generated_openapi_matches_python_inventory() -> None:
    assert _generated_operations() == _inventory_operations()


def test_inventory_has_no_duplicate_operations() -> None:
    operations = _inventory_operations()
    assert len(operations) == len(set(operations))
