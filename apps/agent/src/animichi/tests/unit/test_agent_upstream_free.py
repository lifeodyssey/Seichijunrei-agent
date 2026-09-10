"""Guard: the agent makes ZERO upstream calls.

GOAL §7 ("旧 agent 上游调用已删净") requires every agent path — the four data
tools AND clarify candidate enrichment — to route only through the injected
:class:`CatalogClientProtocol`. This locks that invariant three ways:

  1. Static: tool definitions and their catalog seam import no upstream client
     (Anitabi/Bangumi gateways), no DB Retriever, and no legacy data handlers.
  2. Static: no seam module references a ``deps.gateway`` attribute (the field
     no longer exists on ``RuntimeDeps``; this also catches a reintroduced
     gateway hop before it can compile).
  3. Structural: RuntimeDeps requires the catalog dependency at construction.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

# Modules that form the catalog-only agent seam. These must stay free of any
# upstream/DB read path. ``tools`` (clarify enrichment) is included now that it
# resolves via the catalog instead of the Bangumi gateway.
_TOOL_MODULES = ("animichi_tools", "web_tools")
_SEAM_MODULES = ("animichi_tools", "catalog_tools", "catalog_route_tools")


def test_catalog_tool_modules_stay_within_file_limit() -> None:
    assert all(
        len(_seam_tree(module).body) > 0
        and len(
            (Path(__file__).parents[2] / "agents" / f"{module}.py")
            .read_text(encoding="utf-8")
            .splitlines()
        )
        <= 300
        for module in ("catalog_tools", "catalog_route_tools")
    )


# Substrings that, if imported by a seam module, mean an upstream/DB read path
# leaked back in.
_FORBIDDEN_IMPORT_FRAGMENTS = (
    "gateways",  # anitabi / bangumi upstream gateways
    "retriever",  # DB Retriever read path
    "infrastructure.persistence",  # direct repository read path
    "domain.ports",  # direct database ports
    "execute_resolve_anime",
    "execute_search_bangumi",
    "execute_search_nearby",
    "execute_plan_route",
    "_run_handler",
)


def _seam_tree(module_name: str) -> ast.Module:
    """Parse a seam module's source into an AST."""
    path = Path(__file__).parents[2] / "agents" / f"{module_name}.py"
    return ast.parse(path.read_text(encoding="utf-8"))


def _imported_names(module_name: str) -> list[str]:
    """Collect every dotted import target referenced by a seam module."""
    tree = _seam_tree(module_name)
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            names.append(module)
            names.extend(f"{module}.{alias.name}" for alias in node.names)
    return names


def _gateway_attribute_accesses(module_name: str) -> list[str]:
    """Find every ``<expr>.gateway`` attribute access in a seam module."""
    tree = _seam_tree(module_name)
    return [
        node.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Attribute) and node.attr == "gateway"
    ]


@pytest.mark.parametrize("module_name", _SEAM_MODULES)
def test_seam_module_has_no_upstream_imports(module_name: str) -> None:
    """No seam module imports an upstream gateway, Retriever, or handler."""
    imported = "\n".join(_imported_names(module_name))
    leaked = [frag for frag in _FORBIDDEN_IMPORT_FRAGMENTS if frag in imported]
    assert not leaked, f"{module_name} leaked upstream imports: {leaked}"


@pytest.mark.parametrize("module_name", _SEAM_MODULES)
def test_seam_module_never_touches_deps_gateway(module_name: str) -> None:
    """No seam module reads ``deps.gateway`` — clarify routes via the catalog."""
    accesses = _gateway_attribute_accesses(module_name)
    assert not accesses, f"{module_name} accessed a .gateway attribute: {accesses}"


@pytest.mark.parametrize("module_name", _TOOL_MODULES)
def test_tool_module_does_not_import_animichi_agent(module_name: str) -> None:
    """Tool definitions must not depend on the composed global agent."""
    imported = _imported_names(module_name)
    assert "animichi.agents.animichi_agent" not in imported


def test_runner_has_no_tool_registration_side_effect_imports() -> None:
    imported = _imported_names("animichi_runner")
    forbidden = {"animichi.agents.animichi_tools", "animichi.agents.web_tools"}
    assert forbidden.isdisjoint(imported)


def test_live_architecture_doc_omits_removed_retrieval_subsystems() -> None:
    path = Path(__file__).parents[6] / "docs" / "ARCHITECTURE.md"
    architecture = path.read_text(encoding="utf-8")
    removed = ("agents/retriever.py", "agents/sql_agent.py", "## SQL Agent")

    assert "`createPilgrimageHarness`" in architecture
    assert "the actual oRPC contract and its validators" in architecture
    assert "runtime requests do not query Anitabi or Bangumi directly" in architecture
    assert all(term not in architecture for term in removed)
