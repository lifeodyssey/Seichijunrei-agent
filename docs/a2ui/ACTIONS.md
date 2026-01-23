# A2UI Actions Catalog (v0.1.0)

Actions are user interactions dispatched from the UI back to the agent.

## Action Format

Actions are identified by string names. Some actions include parameters encoded in the name:

```
action_name     = static_action | indexed_action | text_action
static_action   = "reset" | "open_maps_url"
indexed_action  = prefix "_" index
prefix          = "select_candidate" | "remove_point"
text_action     = "send_text:" text
```

## Session Actions

### `reset`

Reset the session to initial state, clearing all progress.

**Trigger**: "Reset" / "重新开始" / "リセット" button  
**Effect**: Clears session state, returns to welcome view

```json
{"action_name": "reset"}
```

## Candidate Selection Actions (Stage 1)

### `select_candidate_{n}`

Select the n-th candidate from the list.

**Trigger**: "Select" button on candidate card  
**Index**: 1-based (first candidate is `select_candidate_1`)  
**Effect**: Sets the selected bangumi and proceeds to Stage 2

```json
{"action_name": "select_candidate_1", "index": 1}
{"action_name": "select_candidate_2", "index": 2}
{"action_name": "select_candidate_3", "index": 3}
```

## Route Editing Actions (Stage 2)

### `remove_point_{n}`

Remove the n-th point from the route.

**Trigger**: "Remove" button on point card  
**Index**: 0-based (first point is `remove_point_0`)  
**Effect**: Removes the point and triggers deterministic replan

```json
{"action_name": "remove_point_0", "index": 0}
{"action_name": "remove_point_1", "index": 1}
```

## Quick Prompt Actions

### `send_text:{text}`

Send text as a user message (for quick prompts/examples).

**Trigger**: Example prompt buttons in welcome view  
**Text**: The encoded text to send

```json
{"action_name": "send_text:けいおん! 京都から", "text": "けいおん! 京都から"}
{"action_name": "send_text:Lucky Star from Washinomiya", "text": "Lucky Star from Washinomiya"}
```

## External Link Actions

### `open_maps_url`

Open the Google Maps directions URL for the planned route.

**Trigger**: "Open in Maps" button  
**Effect**: Opens external browser/app with the route

```json
{"action_name": "open_maps_url", "url": "https://www.google.com/maps/dir/..."}
```

## Action Payload Schema

All actions include at minimum:

```typescript
interface ActionPayload {
  action_name: string;     // Always present
  index?: number;          // For indexed actions
  text?: string;           // For send_text actions
  url?: string;            // For external link actions
}
```

## Parsing Actions

Use the `parse_action()` function from `contracts/a2ui/actions.py`:

```python
from contracts.a2ui.actions import parse_action

payload = parse_action("select_candidate_3")
# {"action_name": "select_candidate_3", "index": 3}

payload = parse_action("remove_point_0")
# {"action_name": "remove_point_0", "index": 0}

payload = parse_action("send_text:Hello")
# {"action_name": "send_text:Hello", "text": "Hello"}
```

## Creating Actions

Use the builder functions:

```python
from contracts.a2ui.actions import (
    make_select_candidate_action,
    make_remove_point_action,
    make_send_text_action,
)

make_select_candidate_action(3)  # "select_candidate_3"
make_remove_point_action(0)       # "remove_point_0"
make_send_text_action("Hello")    # "send_text:Hello"
```
