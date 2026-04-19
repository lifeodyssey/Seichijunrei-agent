# Typing Rules

Comprehensive typing conventions for the Python codebase.

## Core Rule

**No `Any`** in source files — zero explicit `Any` across the codebase.

## Trust Boundaries

Use `object` at trust boundaries (JSON parsing, external API responses), then narrow with `isinstance()`:

```python
# Good
def parse_response(data: object) -> str:
    if isinstance(data, dict) and "name" in data:
        return str(data["name"])
    raise ValueError("unexpected shape")

# Bad
def parse_response(data: Any) -> str:
    return data["name"]
```

## Structured Types

- No `dict[str, object]` — use `dataclass` or Pydantic `BaseModel`
- No `assert` for runtime validation — use `if not x: raise ValueError(...)`
- No bare `str` for IDs/statuses — use `NewType`, `Literal`, or `Enum`

## Protocol Types

Use `Protocol` for duck-typing optional dependencies (OTel, etc.):

```python
class TracerProtocol(Protocol):
    def start_span(self, name: str) -> object: ...
```

This avoids importing the real type at module level, which would make the dependency required.

## cast() at Library Boundaries

Use `cast()` where the real type is known but library stubs are imprecise:

```python
from typing import cast
conn = cast(asyncpg.Connection, await pool.acquire())
```

## Pydantic Metaclass Stubs

Pydantic `BaseModel` subclasses trigger false-positive `explicit-any` from metaclass stubs.
Suppressed via mypy overrides in `pyproject.toml`:

```toml
[[tool.mypy.overrides]]
module = ["backend.agents.models", "backend.domain.*"]
disallow_any_explicit = false
```
