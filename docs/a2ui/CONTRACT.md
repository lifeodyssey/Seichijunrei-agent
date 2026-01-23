# A2UI Contract Specification (v0.1.0)

This document defines the A2UI (Agent-to-User Interface) protocol contract for the Seichijunrei pilgrimage assistant.

## Overview

A2UI is a protocol for agents to communicate with user interfaces. It consists of:

1. **Messages** - Top-level protocol (surfaceUpdate, beginRendering)
2. **Components** - UI building blocks (Text, Button, Card, etc.)
3. **Actions** - User interactions dispatched back to the agent

## Version

- **Protocol Version**: 0.1.0
- **Status**: Experimental

## Implementation

The contract is defined in Python at `contracts/a2ui/`:

- `types.py` - Basic types and enums
- `components.py` - Component definitions and builders
- `actions.py` - Action definitions and parsers
- `messages.py` - Message definitions and builders

## Message Flow

```
Agent                                     UI
  |                                        |
  |-- surfaceUpdate(components) ---------> |
  |-- beginRendering(root) --------------> |
  |                                        | [renders UI]
  |                                        |
  | <---------- action(action_name) -------|
  |                                        |
  |-- surfaceUpdate(new_components) -----> |
  |-- beginRendering(root) --------------> |
```

## Views

The Seichijunrei bot has four views:

| View | State Trigger | Description |
|------|---------------|-------------|
| `welcome` | No session data | Initial state with example prompts |
| `candidates` | `bangumi_candidates` present | Stage 1: Anime candidate selection |
| `route` | `route_plan` present | Stage 2: Route planning and editing |
| `error` | Error occurred | Error display with reset option |

## Surfaces

Currently, there is one surface:

| Surface ID | Description |
|------------|-------------|
| `main` | Primary content area |

## Language Support

The UI supports three languages:

| Code | Language |
|------|----------|
| `zh-CN` | Chinese (Simplified) |
| `en` | English |
| `ja` | Japanese |

Language is determined by the `user_language` field in the extraction result.

## Component Reference

See [MESSAGE_CATALOG.md](./MESSAGE_CATALOG.md) for the full component catalog.

## Action Reference

See [ACTIONS.md](./ACTIONS.md) for the full action catalog.
