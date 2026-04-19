# Backend TDD Coding Skill

Invoke before writing any backend Python code. Enforces Red-Green-Refactor cycle with project-specific Clean Code constraints.

## TDD Cycle

### 1. RED — Write failing test first

```bash
uv run pytest backend/tests/unit/test_<module>.py -v -k "test_<behavior>" --no-header
```

- Test name: `test_<verb>_<scenario>_<expected>` (e.g., `test_returns_empty_when_no_results`)
- One behavior per test. If you write "and" in the test name, split it.
- Assert the WHAT, not the HOW. Test behavior, not implementation.

### 2. GREEN — Minimal code to pass

Write the smallest amount of production code that makes the test green. No more.

```bash
uv run pytest backend/tests/unit/test_<module>.py -v --no-header
```

### 3. REFACTOR — Clean up with tests green

Apply the constraints below. Run tests after every change:

```bash
uv run ruff format backend/ && uv run ruff check backend/ --fix
uv run mypy backend/agents/ backend/interfaces/ backend/domain/ backend/infrastructure/
uv run pytest backend/tests/unit/ -v --no-header -q
```

## Code Constraints

### Size Limits (1-10-50)
- Functions: max 10 lines (excluding signature, docstring). If longer, extract.
- Classes: max 50 lines (excluding imports). If larger, split by responsibility.
- Files: max 300 lines. If larger, module is doing too much.
- Indentation: max 2 levels. Flatten with early return or extract method.

### Type Safety — No Primitive Obsession
- NEVER use `dict[str, object]` for structured data. Use dataclass or Pydantic BaseModel.
- NEVER use bare `str` for IDs, statuses, or enums. Use NewType, Literal, or Enum.
- NEVER use `assert` for runtime validation. Use `if not x: raise ValueError(...)`.
- Use `object` at trust boundaries (JSON parsing), then narrow with `isinstance()`.

### Function Design
- Max 3 parameters. More than 3 → create a parameter object (dataclass).
- Single responsibility. If a function does A then B then C, extract A/B/C.
- Early return. No else after return/raise/continue.
- No nested conditionals. Extract to helper or use guard clauses.

### Naming
- Functions: verb-first (`find_bangumi_by_title`, not `bangumi_lookup`)
- Booleans: `is_`/`has_`/`can_`/`should_` prefix
- Classes: noun, role-based (`RouteOptimizer`, not `RouteHelper`)
- Constants: `SCREAMING_SNAKE`
- Private: single underscore prefix (`_build_params`)

### Module Design
- One reason to change per module (Single Responsibility)
- No feature envy: if a function uses another module's data more than its own, move it
- No god modules: if a file has 5+ unrelated concerns, split it
- Depend on abstractions: handlers take Protocol/ABC interfaces, not concrete classes

## Test Constraints

### Structure
- Test name describes behavior: `test_returns_404_when_session_not_found`
- One assert per test (multiple asserts OK if testing same behavior)
- No conditional logic in tests (no if/else/try-except)
- No timing-dependent assertions. Mock `asyncio.sleep` or use `freezegun`/`time-machine`.

### Assertions
- Assert specific values: `assert result == expected`, not `assert result is not None`
- Include failure messages for non-obvious assertions: `assert len(items) == 3, f"Expected 3 items, got {len(items)}"`
- Use `pytest.raises(ValueError, match="...")` with match pattern

### Mocking
- Mock at boundaries only: DB, HTTP, LLM. Not internal functions.
- Fixtures should be self-documenting. If a fixture sets up complex state, add inline comments.
- Remove unused mock methods from fixtures. Only mock what the test actually calls.
- Prefer `respx` for HTTP mocks, `TestModel` for Pydantic AI.

### Organization
- One test file per production module
- Max 200 lines per test file. Split by feature/concern if larger.
- Use `@pytest.mark.parametrize` for testing multiple inputs with same logic.
- Factory functions for test data (`make_point()`, `make_bangumi()`), not inline dicts.

## Anti-Patterns (from audit — DO NOT introduce)

| Anti-Pattern | Example | Fix |
|---|---|---|
| God function | `handle()` at 217 lines | Extract sub-methods by phase |
| God module | 694-line service file | Split into route modules |
| dict[str, object] | Session state as bare dict | Create SessionState dataclass |
| assert for validation | `assert x is not None` | `if not x: raise ValueError(...)` |
| Duplicated handlers | search_bangumi ≈ search_nearby | Extract shared template |
| Feature envy | Method calls 5+ other module functions | Move logic to owning module |
| Flaky timing test | `assert elapsed >= 0.15` | Mock the clock |
| Eager test | One test, 4 unrelated asserts | Split into 4 tests |
| Mystery guest | Fixture sets hidden state | Make dependencies explicit |
