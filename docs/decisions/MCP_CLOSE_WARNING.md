# MCP Close Warning Analysis

> MCP-003: Evaluate stdio MCP close warning impact

## Issue

When closing MCP stdio sessions, the following warning appears:

```
Error on session runner task: Attempted to exit cancel scope in a different task than it was entered in
Failed to close MCP session: Attempted to exit cancel scope in a different task than it was entered in
```

## Root Cause

The warning originates from AnyIO's cancel scope tracking being violated across task boundaries.

### Technical Details

1. **ADK's `McpToolset`** uses `asyncio.wait_for(enter_async_context(...))` internally
2. This creates a new task boundary for entering the MCP context
3. When the context is exited (on close), it may happen in a different task
4. AnyIO's cancel scope invariants require enter/exit to happen in the same task

### Code Path

```
McpToolset.close()
  → MCP client stack cleanup
    → AnyIO cancel scope exit
      → ❌ Task mismatch detected
```

## Impact Assessment

| Aspect | Impact | Severity |
|--------|--------|----------|
| Tool calls | No impact - calls complete successfully | None |
| Response data | No impact - data returned correctly | None |
| Subprocess cleanup | Potential orphan processes | Low |
| Agent Engine stability | Unknown - needs production testing | Unknown |
| Resource leaks | Possible FD/memory leaks on long runs | Low |

### Evidence

From local testing (`/mcp_probe` command):
- MCP tools are discovered and listed correctly
- `ping` tool executes and returns expected response
- Warning appears only on session close
- No data corruption or missing responses observed

## Mitigation Strategies

### 1. Close Before Yield (Current)

The `McpProbeAgent` already implements this pattern:

```python
try:
    # Do MCP work
    result = await ping_tool.run_async(...)
finally:
    await toolset.close()  # Close BEFORE yielding events

yield Event(...)  # Yield after close
```

This ensures cleanup happens in the same task context as setup.

### 2. Long-Lived MCP Sessions (Future)

For production deployments, consider:
- Create MCP session at agent startup
- Reuse across invocations
- Close only on agent shutdown

This amortizes the close warning impact and may avoid task boundary issues.

### 3. Remote MCP (Alternative)

If stdio continues to cause issues:
- Deploy MCP servers as HTTP/SSE services
- Use `SSEConnectionParams` instead of `StdioConnectionParams`
- Avoids subprocess management entirely

## Recommendations

### Short-term (MVP)

1. **Accept the warning** - It doesn't affect functionality
2. **Follow "close before yield" pattern** - Minimizes task boundary issues
3. **Monitor in production** - Use MCP-001 probe to verify in Agent Engine

### Medium-term

4. **Implement session pooling** - Reuse MCP sessions across invocations
5. **Add subprocess monitoring** - Detect orphan MCP server processes

### Long-term

6. **Evaluate remote MCP** - Based on Agent Engine production behavior
7. **Contribute upstream fix** - If root cause is in ADK/MCP client

## Testing

### Local Verification

```bash
adk run adk_agents/seichijunrei_bot/
# Then type: /mcp_probe
```

Expected output:
```
MCP stdio probe OK.
- server: infrastructure.mcp_servers.ping_server
- tools: ['ping']
- ping result: {"message": "pong: ping", "timestamp": "..."}
```

Warning in stderr (expected):
```
Error on session runner task: Attempted to exit cancel scope...
```

### Production Verification

Deploy to Agent Engine and run `/mcp_probe` to confirm:
1. MCP tools are discoverable
2. Tool calls succeed
3. No impact on subsequent invocations

## Decision

**Status**: Accept with monitoring

The `cancel scope` warning is a known limitation that doesn't affect functionality. We will:
1. Document the pattern for future MCP integrations
2. Monitor production deployments for resource leaks
3. Re-evaluate if issues emerge in Agent Engine

## Related Documents

- [MCP Topology Decision](MCP_TOPOLOGY.md) - Overall MCP strategy
- [MCP Gap Analysis](MCP_GAP_ANALYSIS.md) - Third-party MCP evaluation
- `adk_agents/seichijunrei_bot/_agents/mcp_probe_agent.py` - Implementation
