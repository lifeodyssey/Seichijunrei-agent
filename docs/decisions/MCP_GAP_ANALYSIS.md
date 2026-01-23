# Third-Party MCP Gap Analysis

> **Status:** Analysis Complete
> **Date:** 2026-01-24
> **Task:** MCP-004

## Overview

This document analyzes gaps between self-hosted MCP servers and potential third-party alternatives for the Seichijunrei Bot.

## Current Self-Hosted MCP Servers

### Bangumi MCP Server (`infrastructure/mcp_servers/bangumi_server.py`)

| Tool | Input | Output Schema |
|------|-------|---------------|
| `search_bangumi_subjects` | `keyword: str`, `subject_type: int`, `max_results: int` | `{keyword, results: list[dict], success: bool, error: str\|null}` |
| `get_bangumi_subject` | `subject_id: int` | `{subject_id, subject: dict\|null, success: bool, error: str\|null}` |

### Anitabi MCP Server (`infrastructure/mcp_servers/anitabi_server.py`)

| Tool | Input | Output Schema |
|------|-------|---------------|
| `get_anitabi_points` | `bangumi_id: str` | `{bangumi_id, points: list[PointDict], success: bool, error: str\|null}` |
| `search_anitabi_bangumi_near_station` | `station_name: str`, `radius_km: float` | `{station: StationDict, bangumi_list: list[BangumiDict], radius_km, success, error}` |

## Standardized Error Contract

All self-hosted MCP tools follow a consistent response contract:

```json
{
  "success": true,
  "error": null,
  // ... tool-specific fields
}
```

On failure:
```json
{
  "success": false,
  "error": "Human-readable error message",
  // ... empty/null tool-specific fields
}
```

## Third-Party MCP Server Considerations

### 1. Output Format Differences

| Aspect | Self-Hosted | Typical Third-Party |
|--------|-------------|---------------------|
| Error handling | `{success, error}` wrapper | May throw exceptions or return raw errors |
| Field naming | Consistent snake_case | Varies (camelCase, mixed) |
| Nullable fields | Explicit `null` | May omit fields |
| Date formats | ISO 8601 strings | Varies (timestamps, locale-specific) |
| URL fields | Validated HttpUrl | May be raw strings |

### 2. Missing Capabilities

Current self-hosted servers may lack features available in mature third-party options:

| Capability | Self-Hosted | Third-Party Potential |
|------------|-------------|----------------------|
| Rate limiting | Not implemented | Often built-in |
| Caching | Per-request only | Distributed cache |
| Metrics/observability | Basic logging | Prometheus/OpenTelemetry |
| Authentication | None (trusted network) | OAuth2, API keys, JWT |
| Versioning | None | API version headers |
| Pagination | `max_results` param | Cursor-based pagination |

### 3. Authentication Conventions

| Method | Use Case | Complexity |
|--------|----------|------------|
| None (default) | Internal/trusted networks | Low |
| API Key | Simple external access | Low-Medium |
| OAuth2 | User-delegated access | High |
| mTLS | Service-to-service | High |

**Recommendation:** For self-hosted servers, rely on network isolation (VPC, private endpoints). Add API key authentication only if exposing externally.

## Gap Analysis: Build vs Buy

### Bangumi API Access

| Option | Pros | Cons |
|--------|------|------|
| **Build (current)** | Full control, consistent schema, error handling | Maintenance burden |
| **Buy (third-party)** | Potentially more features | May not exist, schema mismatch |

**Verdict:** Build. No known third-party MCP servers for Bangumi API.

### Anitabi API Access

| Option | Pros | Cons |
|--------|------|------|
| **Build (current)** | Tailored to our domain entities | Maintenance burden |
| **Buy (third-party)** | N/A | Anitabi is niche, no alternatives |

**Verdict:** Build. Anitabi is domain-specific with no alternatives.

### General-Purpose MCP Servers

| Category | Third-Party Options | Our Need |
|----------|---------------------|----------|
| Translation | Google Cloud Translation MCP, DeepL MCP | Could replace `translate_texts` tool |
| Maps/Routing | Google Maps MCP | Could enhance route planning |
| Web Search | Brave Search MCP, Tavily MCP | Not currently needed |
| Weather | OpenWeatherMap MCP | Potential future enhancement |

**Translation Gap:**
- Current: Direct Google Cloud Translation API calls via `tools/translation.py`
- Third-party MCP: Would standardize interface but add MCP overhead
- Verdict: Keep direct integration unless MCP ecosystem matures

**Maps/Routing Gap:**
- Current: `SimpleRoutePlanner` with basic distance calculations
- Third-party MCP: Could provide actual routing, ETA, transit options
- Verdict: Consider for future enhancement (A2UI-007+)

## Schema Compatibility Matrix

If integrating third-party MCP servers, schema transformation may be required:

```
Third-Party Output → Transformer → Self-Hosted Schema
```

| Field Type | Self-Hosted Convention | Transformation Needed |
|------------|------------------------|----------------------|
| IDs | String (`"bg-123"`) | Cast if numeric |
| Coordinates | `{latitude, longitude}` | May need restructuring |
| URLs | Pydantic HttpUrl | Validation |
| Errors | `{success: false, error: str}` | Wrap exceptions |
| Lists | Always `[]` on empty | Handle null → `[]` |

## Recommendations

### Short-Term (MVP)
1. **Keep self-hosted MCP servers** for Bangumi and Anitabi
2. **Maintain consistent error contract** (`{success, error}`)
3. **No third-party MCP integration** until clear value demonstrated

### Medium-Term (Post-MVP)
1. **Evaluate Google Maps MCP** for enhanced routing
2. **Add API key authentication** if exposing MCP servers externally
3. **Implement response caching** in MCP servers

### Long-Term (Scaling)
1. **Consider translation MCP** if multi-language demand grows
2. **Build adapter layer** for third-party MCP schema transformation
3. **Add observability** (metrics, tracing) to MCP servers

## Conclusion

Current self-hosted MCP servers are fit for purpose. Third-party MCP integration is not justified for MVP given:
- Niche domain (anime pilgrimage) with no existing alternatives
- Custom error handling requirements
- Minimal benefit vs integration complexity

Revisit when:
- MCP ecosystem matures with relevant servers
- Scaling requires distributed tool execution
- Multi-provider translation/routing becomes valuable
