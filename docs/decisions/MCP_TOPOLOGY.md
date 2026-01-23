# MCP Topology Decision Document

> **Status:** Decision Required
> **Date:** 2026-01-24
> **Task:** MCP-002

## Overview

This document captures the MCP (Model Context Protocol) topology decision for the Seichijunrei Bot. MCP provides a standardized way to expose tools to LLM agents.

## Current Implementation

The codebase supports three MCP transport modes:

| Transport | Config | Use Case |
|-----------|--------|----------|
| `stdio` | `MCP_TRANSPORT=stdio` | Local development, subprocess-based |
| `sse` | `MCP_TRANSPORT=sse` + `MCP_*_URL` | Remote servers with Server-Sent Events |
| `streamable-http` | `MCP_TRANSPORT=streamable-http` + `MCP_*_URL` | Remote servers with HTTP streaming |

### Files Involved

- `adk_agents/seichijunrei_bot/mcp_toolsets.py` - Toolset factory with transport switching
- `infrastructure/mcp_servers/bangumi_server.py` - Bangumi MCP server
- `infrastructure/mcp_servers/anitabi_server.py` - Anitabi MCP server
- `config/settings.py` - `enable_mcp_tools`, `mcp_transport`, `mcp_*_url` settings

### Default Behavior

MCP is **disabled by default** (`ENABLE_MCP_TOOLS=false`). When disabled, the agent uses direct Python callables (`search_bangumi_subjects`, `get_anitabi_points`) instead of MCP toolsets.

## Decision Points

### 1. Agent Engine stdio Feasibility (MCP-001)

**Question:** Does stdio MCP work in Vertex AI Agent Engine?

**Known Issues:**
- `cancel scope` warnings observed during MCP session cleanup
- Subprocess lifecycle may conflict with Agent Engine's execution model
- stdio assumes persistent process, which may not align with serverless execution

**Required Verification:**
```bash
# Run /mcp_probe on deployed Agent Engine
adk deploy  # Deploy to Agent Engine
# Then query with MCP_TRANSPORT=stdio enabled
```

**Decision Criteria:**
- If stdio works reliably → Use stdio for simplicity
- If stdio fails/unreliable → Use SSE/HTTP with remote MCP servers

### 2. Production Transport (MCP-002)

**Options:**

| Option | Pros | Cons |
|--------|------|------|
| **A: stdio (local subprocess)** | Simple setup, no external servers | May not work in Agent Engine, subprocess management overhead |
| **B: SSE (remote servers)** | Works in any environment, supports horizontal scaling | Requires separate server deployment, added latency |
| **C: streamable-http** | Similar to SSE, different transport semantics | Same as SSE |
| **D: Disabled (direct Python)** | Zero overhead, no MCP complexity | Loses MCP ecosystem benefits (standardized tool interface) |

**Recommendation:** Start with **Option D (disabled)** for MVP, evaluate stdio (Option A) for local development, and reserve SSE (Option B) for future scaling needs.

### 3. Self-hosted vs Third-party MCP Servers

**Current State:**
- We maintain our own MCP servers wrapping application use cases
- This ensures consistent JSON schemas and error handling

**Gap Analysis (MCP-004):**
- Third-party MCP servers may have different output formats
- Authentication conventions vary
- Missing capabilities may require custom implementations

## Recommended Topology

### For Local Development
```
┌─────────────────────────────────────────────────────────────────┐
│                        ADK Agent                                │
│                                                                 │
│  ┌──────────────┐                    ┌──────────────────────┐   │
│  │ Root Agent   │────────────────────│ Direct Python Tools  │   │
│  └──────────────┘   (default)        │ - search_bangumi     │   │
│                                      │ - get_anitabi_points │   │
│                                      └──────────────────────┘   │
│                                                                 │
│  Alternative (ENABLE_MCP_TOOLS=true, MCP_TRANSPORT=stdio):      │
│  ┌──────────────┐     stdio          ┌──────────────────────┐   │
│  │ McpToolset   │────────────────────│ bangumi_server.py    │   │
│  │              │     subprocess     │ anitabi_server.py    │   │
│  └──────────────┘                    └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### For Production (Agent Engine)
```
┌─────────────────────────────────────────────────────────────────┐
│                   Vertex AI Agent Engine                        │
│                                                                 │
│  ┌──────────────┐                    ┌──────────────────────┐   │
│  │ Root Agent   │────────────────────│ Direct Python Tools  │   │
│  └──────────────┘   (recommended)    └──────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

(MCP servers not required if using direct Python tools)
```

### For Future Scaling (if MCP provides value)
```
┌────────────────────────────────────────────────────────────────────────┐
│                   Production with MCP                                  │
│                                                                        │
│  ┌──────────────────┐      SSE/HTTP     ┌─────────────────────────┐   │
│  │ Agent Engine     │───────────────────│ Cloud Run MCP Servers   │   │
│  │ (McpToolset)     │                   │ - bangumi-mcp           │   │
│  └──────────────────┘                   │ - anitabi-mcp           │   │
│                                         └─────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

## Action Items

1. **MCP-001 (Blocking):** Verify stdio MCP in Agent Engine
   - Deploy test agent with `ENABLE_MCP_TOOLS=true`
   - Run `/mcp_probe` command
   - Document results

2. **MCP-002 (This Document):** ✅ Document topology options

3. **MCP-003 (Related):** Investigate `cancel scope` warnings
   - May indicate subprocess cleanup issues
   - Could require long-lived MCP session pattern

4. **MCP-004 (Related):** Third-party MCP gap analysis
   - Document output format differences
   - Identify missing capabilities
   - Plan build-vs-buy decisions

## Configuration Reference

```bash
# Disable MCP (default, recommended for MVP)
ENABLE_MCP_TOOLS=false

# Enable MCP with stdio (local development)
ENABLE_MCP_TOOLS=true
MCP_TRANSPORT=stdio

# Enable MCP with SSE (remote servers)
ENABLE_MCP_TOOLS=true
MCP_TRANSPORT=sse
MCP_BANGUMI_URL=https://bangumi-mcp.example.com/sse
MCP_ANITABI_URL=https://anitabi-mcp.example.com/sse

# Enable MCP with streamable HTTP
ENABLE_MCP_TOOLS=true
MCP_TRANSPORT=streamable-http
MCP_BANGUMI_URL=https://bangumi-mcp.example.com/mcp
MCP_ANITABI_URL=https://anitabi-mcp.example.com/mcp
```

## Conclusion

**Recommended approach for MVP:**
- Keep MCP disabled (`ENABLE_MCP_TOOLS=false`)
- Use direct Python tools for simplicity and reliability
- Revisit MCP adoption when:
  - Standard MCP ecosystem tools become valuable
  - Horizontal scaling of tool execution is needed
  - Agent Engine stdio verification is complete
