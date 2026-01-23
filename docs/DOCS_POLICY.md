# Documentation Policy

> DOC-001: Established minimal documentation rules

## Philosophy

**"少而准" (Less but accurate)**

Code and tests are the source of truth. Documentation describes stable boundaries and usage patterns only. Minimize maintenance burden.

## Canonical Documents

| Document | Purpose | Owner |
|----------|---------|-------|
| `README.md` | User entry point: install, run, common commands, architecture overview | All |
| `DEPLOYMENT.md` | Vertex AI Agent Engine deployment guide | DevOps |
| `docs/ARCHITECTURE.md` | Deep architecture reference (optional) | Architecture |
| `docs/a2ui/` | A2UI protocol contracts and session model | A2UI Team |
| `docs/MCP_VERIFICATION.md` | MCP feasibility findings | Infrastructure |

## Working Documents (Planning)

These documents support the planning-with-files workflow and may contain process-level detail:

| Document | Purpose |
|----------|---------|
| `task_plan.md` | Main task tracking |
| `task_plan_a2ui.md` | A2UI subproject plan |
| `findings.md` | Research findings and decisions |
| `progress.md` | Session progress log |
| `TODO.adk.md` | ADK-related backlog |

## Writing Rules

### Avoid Drift

❌ **Don't** hardcode counts or volatile metrics:
```markdown
The system uses 5 agents and 12 tools...
```

✅ **Do** reference code or commands:
```markdown
See `adk_agents/seichijunrei_bot/agent.py` for agent composition.
Run `adk run adk_agents/seichijunrei_bot/` to see available tools.
```

### Single Source of Truth

| Information | Source |
|-------------|--------|
| State keys | `adk_agents/seichijunrei_bot/_state.py` |
| Schemas | `adk_agents/seichijunrei_bot/_schemas.py` |
| Config options | `config/settings.py` |
| A2UI actions | `contracts/a2ui/actions.py` |
| A2UI components | `contracts/a2ui/components.py` |

### Diagrams

- **One high-level diagram** per major concept
- No duplicate diagrams across documents
- Prefer Mermaid (text-based, diff-friendly)
- Link to code for implementation details

### Separation of Concerns

| Topic | Location |
|-------|----------|
| User onboarding | `README.md` |
| Deployment | `DEPLOYMENT.md` |
| Architecture deep-dive | `docs/ARCHITECTURE.md` |
| A2UI protocol | `docs/a2ui/` |
| Planning/progress | `task_plan*.md`, `findings.md`, `progress.md` |

## Documents to Avoid

| Pattern | Problem | Alternative |
|---------|---------|-------------|
| Long-form writeups | High drift, duplicate content | Keep README concise |
| Generated diagram folders | Require sync with code | Inline Mermaid or code links |
| Roadmap documents | Duplicate task plans | Use `task_plan.md` |
| API documentation | Duplicates code | Use docstrings + type hints |

## Review Checklist

Before merging documentation changes:

- [ ] Does it reference code instead of hardcoding values?
- [ ] Is there a single source of truth for this information?
- [ ] Will this document stay accurate without constant updates?
- [ ] Is this the right location for this content?
- [ ] Does it duplicate existing documentation?

## Enforcement

1. PR reviews should check documentation against these rules
2. Stale documentation should be updated or removed
3. New features should document only stable interfaces
4. Implementation details belong in code comments, not docs
