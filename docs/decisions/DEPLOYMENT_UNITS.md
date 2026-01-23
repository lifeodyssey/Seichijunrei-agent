# Deployment Units Decision

> ARCH-004: Clarify deployment unit vs reusable library boundaries

## Decision

The repository contains two distinct deployment contexts:

1. **Reusable Library** (wheel package)
2. **ADK Application** (deployment unit)

## Package Structure

### Wheel Package (Library)

Included in `pyproject.toml` packages:
```python
packages = ["application", "clients", "config", "domain", "infrastructure", "services", "utils"]
```

These modules are:
- Reusable across different applications
- Follow clean architecture patterns
- Have stable public interfaces
- Can be imported as a dependency

### ADK Application (Not in Wheel)

Excluded from wheel:
```
adk_agents/           # ADK agent definitions
interfaces/           # Web UIs and servers
tools/               # ADK FunctionTools
contracts/           # A2UI protocol contracts
```

These are:
- Deployment-specific configurations
- ADK agent trees that compose the library modules
- Interface implementations (A2UI web, A2A server)
- Not meant to be imported as a library dependency

## Rationale

### Why Separate?

1. **ADK agents are deployment artifacts**
   - They wire together library components
   - Configuration is environment-specific
   - Agent prompts may vary per deployment

2. **Library stays stable**
   - Clean architecture layers have stable interfaces
   - Gateways and use cases are reusable
   - Domain models don't depend on agent framework

3. **Flexibility**
   - Same library can power different agent configurations
   - A2UI and CLI can share library code
   - Testing doesn't require full ADK stack

### Deployment Patterns

| Context | What Gets Deployed |
|---------|-------------------|
| Agent Engine | `adk_agents/seichijunrei_bot/` + library wheel |
| A2UI Web | `interfaces/a2ui_web/` + library wheel |
| A2A Server | `interfaces/a2a_server/` + library wheel |
| Library Only | wheel package (pip installable) |

## File References

- Package config: `pyproject.toml`
- ADK entry point: `adk_agents/seichijunrei_bot/agent.py`
- Root agent: `RouteStateMachineAgent`
- Library modules: `application/`, `domain/`, `infrastructure/`, etc.

## Future Considerations

- If `adk_agents/` becomes a published SDK, reconsider packaging
- Consider monorepo split if library grows significantly
- MCP servers may need separate deployment consideration
