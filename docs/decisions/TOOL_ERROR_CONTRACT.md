# Tool Error Contract

> ADK-002: Unified tool/BaseAgent error contract

## Decision

All ADK tools return a **structured dictionary** with consistent fields to prevent ADK pipeline crashes.

## Contract

### Response Structure

```python
{
    "success": bool,           # Required: whether operation succeeded
    "error": str | None,       # Required: error message if failed
    # ... tool-specific data fields
}
```

### Success Response

```python
{
    "success": True,
    "error": None,
    "keyword": "search term",
    "results": [...]
}
```

### Error Response

```python
{
    "success": False,
    "error": "Human-readable error message",
    "keyword": "search term",
    "results": []  # Empty or default value
}
```

## Implementation Pattern

```python
async def my_tool(param: str) -> dict:
    """Tool docstring with Args/Returns."""
    try:
        # Business logic via use case
        result = await use_case(param)
        return {
            "success": True,
            "error": None,
            "param": param,
            "data": result,
        }
    except Exception as e:
        logger.error("my_tool failed", param=param, error=str(e), exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "param": param,
            "data": None,  # or empty default
        }
```

## Rationale

### Why Not Raise Exceptions?

1. **ADK Pipeline Stability**: Uncaught exceptions can cause "broken pipe" errors in ADK's streaming execution model
2. **LLM Error Handling**: The LLM can interpret `success: false` and retry or ask the user for clarification
3. **Graceful Degradation**: Partial failures don't crash the entire conversation

### Why Not Use ToolResult Class?

The `ToolResult` dataclass exists but raw dicts are used because:
1. ADK expects plain dicts from FunctionTools
2. Simpler to serialize/deserialize
3. No type coercion issues

The `ToolResult` class is available for internal use where strong typing is valuable.

## Error Codes

Standard error codes (from `tools/result.py`):

| Code | Description |
|------|-------------|
| `external_service_error` | Third-party API failure |
| `rate_limited` | Rate limit exceeded |
| `timeout` | Request timeout |
| `not_found` | Resource not found |
| `invalid_input` | Validation error |
| `internal_error` | Unexpected internal error |

## Existing Tool Compliance

| Tool | Follows Contract |
|------|-----------------|
| `search_bangumi_subjects` | ✅ |
| `get_bangumi_subject` | ✅ |
| `get_anitabi_points` | ✅ |
| `search_anitabi_bangumi_near_station` | ✅ |
| `translate_tool` | ✅ |

## File References

- Contract implementation: `adk_agents/seichijunrei_bot/tools/result.py`
- Tool definitions: `adk_agents/seichijunrei_bot/tools/__init__.py`
- Translation tool: `adk_agents/seichijunrei_bot/tools/translation.py`
