"""Unit tests for step dependency graph."""

from backend.agents.models import STEP_DEPENDENCIES, ToolName


class TestStepDependencies:
    def test_all_tools_have_entries(self) -> None:
        """Every ToolName must appear in STEP_DEPENDENCIES."""
        for tool in ToolName:
            assert tool in STEP_DEPENDENCIES, f"{tool} missing from STEP_DEPENDENCIES"

    def test_search_bangumi_requires_resolve(self) -> None:
        assert ToolName.RESOLVE_ANIME in STEP_DEPENDENCIES[ToolName.SEARCH_BANGUMI]

    def test_plan_route_requires_search(self) -> None:
        assert ToolName.SEARCH_BANGUMI in STEP_DEPENDENCIES[ToolName.PLAN_ROUTE]

    def test_leaf_tools_have_no_deps(self) -> None:
        leaf_tools = [
            ToolName.RESOLVE_ANIME,
            ToolName.SEARCH_NEARBY,
            ToolName.GREET_USER,
            ToolName.ANSWER_QUESTION,
            ToolName.CLARIFY,
        ]
        for tool in leaf_tools:
            assert STEP_DEPENDENCIES[tool] == [], f"{tool} should have no deps"

    def test_no_circular_deps(self) -> None:
        """Dependency graph must be a DAG (no cycles)."""
        visited: set[ToolName] = set()
        path: set[ToolName] = set()

        def dfs(tool: ToolName) -> bool:
            if tool in path:
                return False  # cycle detected
            if tool in visited:
                return True
            path.add(tool)
            for dep in STEP_DEPENDENCIES.get(tool, []):
                if not dfs(dep):
                    return False
            path.remove(tool)
            visited.add(tool)
            return True

        for tool in ToolName:
            assert dfs(tool), f"Circular dependency detected involving {tool}"
