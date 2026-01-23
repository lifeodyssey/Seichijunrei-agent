# A2UI Message Catalog (v0.1.0)

This document catalogs all message types and components used in the A2UI protocol.

## Message Types

### surfaceUpdate

Updates a surface with new components. Must be followed by `beginRendering`.

```json
{
  "surfaceUpdate": {
    "surfaceId": "main",
    "components": [/* component list */]
  }
}
```

### beginRendering

Signals that a surface is ready to render. Specifies the root component.

```json
{
  "beginRendering": {
    "surfaceId": "main",
    "root": "root"
  }
}
```

### Standard Message Sequence

A complete surface update requires both messages in order:

```json
[
  {"surfaceUpdate": {"surfaceId": "main", "components": [...]}},
  {"beginRendering": {"surfaceId": "main", "root": "root"}}
]
```

## Components

### Text

Displays text content with optional styling hint.

```json
{
  "id": "header-1",
  "component": {
    "Text": {
      "text": {"literalString": "Welcome to Seichijunrei"},
      "usageHint": "h2"
    }
  }
}
```

**Usage Hints:**
| Hint | Use Case |
|------|----------|
| `h1` | Page title |
| `h2` | Section header |
| `h3` | Sub-section header |
| `h4` | Card title |
| `body` | Body text |
| `caption` | Secondary/metadata text |

### Divider

Visual separator between content.

```json
{
  "id": "divider-1",
  "component": {
    "Divider": {"axis": "horizontal"}
  }
}
```

### Image

Displays an image from URL.

```json
{
  "id": "cover-img",
  "component": {
    "Image": {
      "url": {"literalString": "https://example.com/image.jpg"}
    }
  }
}
```

### Row

Horizontal layout container.

```json
{
  "id": "button-row",
  "component": {
    "Row": {
      "children": {"explicitList": ["btn-1", "btn-2", "btn-3"]},
      "distribution": "end",
      "alignment": "center"
    }
  }
}
```

**Distribution Options:**
- `start` - Align items to start
- `center` - Center items
- `end` - Align items to end
- `space-between` - Space between items
- `space-around` - Space around items

**Alignment Options:**
- `start` - Align to cross-axis start
- `center` - Center on cross-axis
- `end` - Align to cross-axis end
- `stretch` - Stretch to fill

### Column

Vertical layout container.

```json
{
  "id": "root",
  "component": {
    "Column": {
      "children": {"explicitList": ["header", "divider-1", "content", "footer"]},
      "alignment": "stretch"
    }
  }
}
```

### Card

Card container for grouped content.

```json
{
  "id": "candidate-card-1",
  "component": {
    "Card": {
      "content": "card-1-content"
    }
  }
}
```

### Button

Interactive button with action.

```json
{
  "id": "select-btn-1",
  "component": {
    "Button": {
      "label": {"literalString": "Select"},
      "action": "select_candidate_1",
      "primary": true
    }
  }
}
```

## View Layouts

### Welcome View

```
Column [root]
├── Text [header] - "Seichijunrei Pilgrimage Assistant" (h2)
├── Text [hint] - Instructions (body)
├── Divider [divider-1]
└── Row [examples-row]
    ├── Button [example-btn-1] - Example prompt 1 (primary)
    ├── Button [example-btn-2] - Example prompt 2
    └── Button [example-btn-3] - Example prompt 3
```

### Candidates View (Stage 1)

```
Column [root]
├── Text [header] - "Candidates (query: ...)" (h3)
├── Divider [divider-1]
├── Column [cand-list]
│   ├── Card [cand-card-1]
│   │   └── Column [cand-card-1-content]
│   │       ├── Text [cand-card-1-title] (h4)
│   │       ├── Text [cand-card-1-subtitle] (caption)
│   │       ├── Text [cand-card-1-summary] (body)
│   │       └── Row [cand-card-1-actions]
│   │           └── Button [cand-card-1-select] - "Select" (primary)
│   ├── Card [cand-card-2]
│   └── Card [cand-card-3]
├── Divider [divider-2]
└── Row [controls-row]
    └── Button [cand-reset] - "Reset"
```

### Route View (Stage 2)

```
Column [root]
├── Text [header] - Route info (h3)
├── Divider [divider-1]
├── Column [route-steps]
│   └── Card [step-card-{n}]
│       └── Column [step-{n}-content]
│           ├── Text [step-{n}-title] (h4)
│           ├── Text [step-{n}-meta] (caption)
│           ├── Image [step-{n}-image] (optional)
│           └── Row [step-{n}-actions]
│               └── Button [step-{n}-remove] - "Remove"
├── Divider [divider-2]
├── Card [tips] (optional)
│   └── Column [tips-content]
│       ├── Text [tips-header] (h4)
│       └── Text [tips-text] (body)
├── Divider [divider-3]
└── Row [controls-row]
    ├── Button [open-maps] - "Open in Maps" (primary)
    └── Button [reset] - "Reset"
```

## Building Messages (Python)

```python
from contracts.a2ui.components import text, button, column, row
from contracts.a2ui.messages import build_surface_messages

# Build components
components = [
    column("root", ["header", "content"], alignment="stretch"),
    text("header", "Hello", usage_hint="h2"),
    text("content", "Welcome to the app", usage_hint="body"),
]

# Build messages
messages = build_surface_messages("main", components, root_id="root")

# Result:
# [
#   {"surfaceUpdate": {"surfaceId": "main", "components": [...]}},
#   {"beginRendering": {"surfaceId": "main", "root": "root"}}
# ]
```
