# Configuration Architecture

> ARCH-001: Unified config loading with secrets separation

## Decision

All application configuration flows through a single entry point (`config/settings.py`) with clear separation between:
1. **Secrets** - Sensitive credentials that should never be logged
2. **Runtime Config** - Non-sensitive operational parameters
3. **Feature Flags** - Boolean toggles for optional features

## Configuration Categories

### Secrets (Never Log)

| Setting | Env Var | Description |
|---------|---------|-------------|
| `google_maps_api_key` | `GOOGLE_MAPS_API_KEY` | Google Maps API key |
| `gemini_api_key` | `GEMINI_API_KEY` | Gemini API key (legacy) |
| `weather_api_key` | `WEATHER_API_KEY` | Weather API key |
| `google_application_credentials` | `GOOGLE_APPLICATION_CREDENTIALS` | GCP service account path |

### Runtime Config (Safe to Log)

| Setting | Env Var | Default | Description |
|---------|---------|---------|-------------|
| `app_env` | `APP_ENV` | `development` | Environment name |
| `log_level` | `LOG_LEVEL` | `INFO` | Logging level |
| `debug` | `DEBUG` | `False` | Debug mode |
| `max_retries` | `MAX_RETRIES` | `3` | API retry attempts |
| `timeout_seconds` | `TIMEOUT_SECONDS` | `30` | Request timeout |
| `cache_ttl_seconds` | `CACHE_TTL_SECONDS` | `3600` | Cache TTL |

### Feature Flags

| Setting | Env Var | Default | Description |
|---------|---------|---------|-------------|
| `use_cache` | `USE_CACHE` | `True` | Enable caching |
| `enable_mcp_tools` | `ENABLE_MCP_TOOLS` | `False` | Enable MCP toolsets |
| `enable_state_contract_validation` | `ENABLE_STATE_CONTRACT_VALIDATION` | `True` | Validate skill contracts |

### Service URLs (Environment-Specific)

| Setting | Env Var | Default | Description |
|---------|---------|---------|-------------|
| `anitabi_api_url` | `ANITABI_API_URL` | `https://api.anitabi.cn/bangumi` | Anitabi API |
| `weather_api_url` | `WEATHER_API_URL` | OpenWeatherMap | Weather API |
| `mcp_bangumi_url` | `MCP_BANGUMI_URL` | None | MCP Bangumi server |
| `mcp_anitabi_url` | `MCP_ANITABI_URL` | None | MCP Anitabi server |

## Usage Pattern

### Single Entry Point

```python
from config import get_settings

settings = get_settings()  # Cached singleton
```

### Accessing Values

```python
# Runtime config (safe to log)
logger.info("Starting app", env=settings.app_env, debug=settings.debug)

# Secrets (use masked repr)
logger.debug("Config loaded", settings=str(settings))  # Auto-masked

# Feature flags
if settings.enable_mcp_tools:
    toolset = create_mcp_toolset()
```

### Environment-Specific Behavior

```python
if settings.is_production:
    # Strict validation
    missing = settings.validate_api_keys()
    if missing:
        raise ConfigurationError(f"Missing: {missing}")
elif settings.is_development:
    # Warn but continue
    pass
```

## Secret Masking

The `Settings.__repr__` method automatically masks secrets:

```python
>>> str(settings)
Settings(app_env='development', debug=False, log_level='INFO',
         google_maps_api_key=AIza...***,
         gemini_api_key=(empty),
         weather_api_key=(empty))
```

## Validation

### At Startup

- Log level validated against allowed values
- A2UI backend validated (`local` or `agent_engine`)
- MCP transport validated (`stdio`, `sse`, `streamable-http`)
- Missing API keys trigger warnings (non-blocking)

### At Runtime

```python
# Explicit validation when needed
missing = settings.validate_api_keys()
if missing:
    raise ValueError(f"Missing required keys: {missing}")
```

## .env File Structure

```bash
# === Secrets (never commit) ===
GOOGLE_MAPS_API_KEY=your-key-here
GOOGLE_API_KEY=your-gemini-key  # Used by ADK
# WEATHER_API_KEY=optional

# === Runtime Config ===
APP_ENV=development
LOG_LEVEL=INFO
DEBUG=false
MAX_RETRIES=3
TIMEOUT_SECONDS=30

# === Feature Flags ===
USE_CACHE=true
ENABLE_MCP_TOOLS=false
ENABLE_STATE_CONTRACT_VALIDATION=true

# === Service URLs (override for testing) ===
# ANITABI_API_URL=http://localhost:8080/bangumi

# === A2UI Config ===
A2UI_BACKEND=local
A2UI_PORT=8081
# A2UI_VERTEXAI_PROJECT=your-project
# A2UI_AGENT_ENGINE_NAME=your-engine
```

## Best Practices

1. **Never log secrets directly** - Use `str(settings)` for masked output
2. **Use feature flags** - Don't hardcode boolean conditions
3. **Validate early** - Call `validate_api_keys()` at startup if strict
4. **Cache settings** - `get_settings()` is cached; don't create new instances
5. **Environment separation** - Use `.env.example` as template, `.env` for local

## File References

- Settings class: `config/settings.py`
- Environment template: `.env.example`
- Usage examples: `adk_agents/seichijunrei_bot/agent.py`
