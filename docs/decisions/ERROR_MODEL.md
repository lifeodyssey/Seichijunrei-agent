# Error Model Architecture

> ARCH-002: Unified domain/app/infra error mapping

## Decision

All errors flow through application-level exceptions defined in `application/errors.py`. Infrastructure-specific exceptions are caught and mapped at the gateway layer.

## Error Hierarchy

```
ApplicationError (base)
├── InvalidInputError      - validation failures
├── NotFoundError          - resource not found
├── ExternalServiceError   - external API failures
│   ├── RateLimitError     - rate limit exceeded
│   └── ServiceTimeoutError - request timeout
└── ConfigurationError     - missing/invalid config
```

## Error Flow

```
Infrastructure          Gateway              Use Case           Interface
─────────────────────────────────────────────────────────────────────────
HTTPError         →    ExternalServiceError    →    (propagate)    →    JSON response
ValidationError   →    InvalidInputError       →    (propagate)    →    400 Bad Request
ConnectionError   →    ServiceTimeoutError     →    (propagate)    →    503 Unavailable
RateLimitResponse →    RateLimitError          →    (propagate)    →    429 Too Many
```

## Error Mapping in Gateways

Gateways convert infrastructure exceptions to application errors:

```python
# infrastructure/gateways/bangumi.py
async def search(self, keyword: str) -> list[dict]:
    try:
        return await self._client.search(keyword)
    except ValidationError as exc:
        raise InvalidInputError(str(exc)) from exc
    except APIError as exc:
        raise ExternalServiceError("bangumi", str(exc)) from exc
```

## Error Codes

Each error type has a standardized `error_code`:

| Error Type | Code | HTTP Status |
|------------|------|-------------|
| `InvalidInputError` | `invalid_input` | 400 |
| `NotFoundError` | `not_found` | 404 |
| `ExternalServiceError` | `external_service_error` | 502 |
| `RateLimitError` | `rate_limited` | 429 |
| `ServiceTimeoutError` | `timeout` | 504 |
| `ConfigurationError` | `configuration_error` | 500 |

## Tool Error Contract

ADK tools return structured dicts instead of raising exceptions:

```python
async def my_tool(param: str) -> dict:
    try:
        result = await use_case(param)
        return {"success": True, "error": None, "data": result}
    except ApplicationError as e:
        return {"success": False, "error": e.message, "error_code": e.error_code}
```

See [TOOL_ERROR_CONTRACT.md](TOOL_ERROR_CONTRACT.md) for details.

## Serialization

All errors support `to_dict()` for API responses:

```python
try:
    result = await use_case.execute(input)
except ApplicationError as e:
    return JSONResponse(
        status_code=error_to_status(e),
        content=e.to_dict()
    )
```

Response format:
```json
{
  "error_code": "external_service_error",
  "message": "bangumi: connection refused",
  "details": {"service": "bangumi"}
}
```

## Usage Examples

### Raising Errors

```python
# In gateway
if response.status == 429:
    raise RateLimitError("bangumi", retry_after=response.headers.get("Retry-After"))

# In use case
if not keyword:
    raise InvalidInputError("keyword is required", field="keyword")

# In config validation
if not settings.google_maps_api_key:
    raise ConfigurationError("Missing API key", missing_keys=["GOOGLE_MAPS_API_KEY"])
```

### Catching Errors

```python
# Catch specific error
try:
    result = await gateway.search(keyword)
except NotFoundError:
    return []  # Return empty for not found

# Catch category
try:
    result = await gateway.search(keyword)
except ExternalServiceError as e:
    logger.error("Service failed", service=e.service, detail=e.detail)
    raise

# Catch all application errors
try:
    result = await use_case.execute(input)
except ApplicationError as e:
    return error_response(e)
```

## Testing

Error mapping is tested in `tests/unit/test_gateway_error_mapping.py`:

```python
def test_api_error_maps_to_external_service_error():
    with pytest.raises(ExternalServiceError) as exc_info:
        await gateway.search("test")
    assert exc_info.value.service == "bangumi"
```

## File References

- Error definitions: `application/errors.py`
- Gateway implementations: `infrastructure/gateways/`
- Tool error contract: `docs/decisions/TOOL_ERROR_CONTRACT.md`
- Error mapping tests: `tests/unit/test_gateway_error_mapping.py`
