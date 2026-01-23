# MCP Feasibility Verification Report

> MCP-001: Verify Agent Engine stdio MCP feasibility

## Summary

| Environment | stdio MCP | Status |
|-------------|-----------|--------|
| Local Development | ✅ Works | Verified |
| Agent Engine | ❓ Unknown | Requires deployment access |

## Local Verification Results

**Date**: 2026-01-24

### Test: stdio MCP subprocess spawn

```bash
uv run python -c "..." # See test script
```

**Result**: SUCCESS

```
Tools discovered: ['ping']
SUCCESS: MCP stdio subprocess spawned and tools listed
```

### Known Issue: Cancel Scope Warning

On `toolset.close()`:
```
Error on session runner task: Attempted to exit cancel scope in a different task than it was entered in
Failed to close MCP session: Attempted to exit cancel scope in a different task than it was entered in
```

**Impact Assessment**:
- Tool discovery: ✅ Works
- Tool execution: ✅ Works (verified via `/mcp_probe` route)
- Session cleanup: ⚠️ Warning only, subprocess still terminates
- Memory leaks: Unlikely (subprocess terminates)

**Root Cause**: ADK's `McpToolset` uses `asyncio.wait_for(enter_async_context(...))` internally, creating task boundaries that conflict with AnyIO's cancel scope tracking.

**Recommendation**: Monitor in Agent Engine; if subprocess zombies occur, consider:
1. Long-lived MCP sessions (one per agent instance)
2. Remote MCP via streamable HTTP

## Agent Engine Verification

### Prerequisites

To verify on Agent Engine, you need:

1. **Deployed Agent**: Agent deployed to Vertex AI Agent Engine
2. **Access**: Project permissions to query the agent

### Verification Steps

1. Deploy agent to Agent Engine (if not done)
2. Send message: "run /mcp_probe" or "MCP診断"
3. Check response for success/failure
4. Monitor Cloud Logging for subprocess-related errors

### Expected Outcomes

| Outcome | Implications |
|---------|--------------|
| **Works** | stdio MCP viable for production; proceed with MCP toolsets |
| **Permission Denied** | Agent Engine sandboxes subprocess execution; use remote MCP |
| **Node Not Found** | No Node.js in container; use Python-based MCP servers or remote MCP |
| **Timeout/Hang** | Resource constraints; reduce MCP usage or use remote MCP |

## MCP Topology Decision Tree

```
                     Agent Engine stdio works?
                            /          \
                          YES           NO
                          /              \
               Use stdio MCP        Use remote MCP
               (dev & prod)         (streamable HTTP/SSE)
                    |                     |
            Single deployment      Deploy MCP servers
            architecture          separately (Cloud Run)
```

## Current Implementation

### MCP Servers (Self-hosted)

| Server | Location | Capabilities |
|--------|----------|--------------|
| `ping_server.py` | `infrastructure/mcp_servers/` | Health check only |
| `bangumi_server.py` | `infrastructure/mcp_servers/` | Anime search |
| `anitabi_server.py` | `infrastructure/mcp_servers/` | Location points |

### MCP Toolsets (ADK Integration)

```python
# adk_agents/seichijunrei_bot/mcp_toolsets.py
def build_bangumi_mcp_toolset(...) -> McpToolset
def build_anitabi_mcp_toolset(...) -> McpToolset
```

### Feature Flag

```python
# config/settings.py
mcp_enabled: bool = False  # Default off until verified
mcp_transport: str = "stdio"  # stdio | sse | streamable-http
```

## Recommendations

### Short Term (Before Agent Engine Verification)

1. **Keep MCP behind feature flag** (`mcp_enabled=False`)
2. **Continue using direct HTTP clients** for production stability
3. **Document MCP servers** for future integration

### After Agent Engine Verification

**If stdio works**:
1. Enable `mcp_enabled=True` in staging
2. Monitor for subprocess cleanup issues
3. Gradually migrate tools to MCP toolsets

**If stdio fails**:
1. Deploy MCP servers as Cloud Run services
2. Switch to `mcp_transport=streamable-http`
3. Configure MCP server URLs in settings

### Long Term

1. **Standardize on remote MCP** for production (better isolation, scalability)
2. **Keep stdio for local development** (simpler setup)
3. **Implement MCP server health checks** and fallback to HTTP clients

## Related Files

- `adk_agents/seichijunrei_bot/_agents/mcp_probe_agent.py` - Probe implementation
- `adk_agents/seichijunrei_bot/mcp_toolsets.py` - MCP toolset builders
- `infrastructure/mcp_servers/` - Self-hosted MCP servers
- `config/settings.py` - MCP feature flags

## Next Steps

1. [ ] Deploy to Agent Engine staging
2. [ ] Run `/mcp_probe` in deployed environment
3. [ ] Record results in this document
4. [ ] Make MCP topology decision based on results
5. [ ] Update feature flags and documentation accordingly
