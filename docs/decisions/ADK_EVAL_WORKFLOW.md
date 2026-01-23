# ADK Eval Workflow

> TEST-005: Reproducible `adk eval` process and evalset maintenance

## Overview

This document defines the workflow for running ADK evaluations and maintaining evalsets.

## Available Evalsets

| Evalset | File | Description | Eval Cases |
|---------|------|-------------|------------|
| `hibiki` | `hibiki.evalset.json` | Hibike! Euphonium (Uji) scenarios | 2 |
| `gbc` | `gbc.evalset.json` | Girls Band Cry scenarios | TBD |

## Running Evaluations

### Prerequisites

1. Set up API keys:
   ```bash
   export GOOGLE_API_KEY="your-gemini-api-key"
   export BANGUMI_ACCESS_TOKEN="your-token"  # Optional
   ```

2. Ensure ADK CLI is installed:
   ```bash
   pip install google-adk
   ```

### Run Evaluation

```bash
# Navigate to agent directory
cd adk_agents/seichijunrei_bot

# Run specific evalset
adk eval --evalset hibiki.evalset.json

# Run all evalsets
adk eval --evalset hibiki.evalset.json --evalset gbc.evalset.json

# Run with verbose output
adk eval --evalset hibiki.evalset.json --verbose
```

### Expected Output

```
Running evaluation: hibiki
  Case: hibiki uji ... PASS (4 turns)
  Case: hibiki nagoya ... PASS (2 turns)
Results: 2/2 passed
```

## Evalset Structure

```json
{
  "eval_set_id": "unique-id",
  "name": "human-readable-name",
  "eval_cases": [
    {
      "eval_id": "case-id",
      "conversation": [
        {
          "invocation_id": "e-...",
          "user_content": { "parts": [...], "role": "user" },
          "final_response": { "parts": [...], "role": "model" },
          "intermediate_data": { ... }
        }
      ],
      "session_input": {
        "app_name": "seichijunrei_bot",
        "user_id": "user",
        "state": { ... }
      }
    }
  ]
}
```

## Recording New Eval Cases

### Step 1: Run Interactive Session

```bash
adk web adk_agents/seichijunrei_bot/
# Or
adk run adk_agents/seichijunrei_bot/
```

### Step 2: Execute Test Scenario

Walk through the complete conversation flow:
1. Initial query (e.g., "我在宇治 想去巡礼京吹")
2. Confirmation or selection
3. Route generation
4. (Optional) Refinement requests

### Step 3: Export Session

From ADK web interface:
- Click "Export" button
- Save as `.evalset.json`

Or manually capture from logs and format as evalset JSON.

### Step 4: Add to Evalset

```python
# Merge new case into existing evalset
import json

with open("hibiki.evalset.json") as f:
    evalset = json.load(f)

evalset["eval_cases"].append(new_case)

with open("hibiki.evalset.json", "w") as f:
    json.dump(evalset, f, indent=2, ensure_ascii=False)
```

## Evalset Maintenance

### When to Update Evalsets

1. **After schema changes**: If `_state.py` keys change, update `session_input.state`
2. **After prompt changes**: Re-record affected conversations
3. **After tool changes**: Verify `intermediate_data` still matches expectations
4. **After workflow changes**: Check `transfer_to_agent` calls match new structure

### Evalset Hygiene

- Keep evalsets focused (one scenario per case)
- Use descriptive `eval_id` names
- Document expected behavior in comments
- Remove obsolete cases when workflows change

### Version Control

- Evalsets are committed to git
- Use meaningful commit messages when updating evalsets
- Consider tagging evalsets with agent version

## Evaluation Criteria

ADK eval checks:

| Criterion | Description |
|-----------|-------------|
| Response similarity | Final response matches expected pattern |
| Tool call sequence | Correct tools called in correct order |
| State mutations | Session state updated as expected |
| No errors | No uncaught exceptions during execution |

## Troubleshooting

### Common Issues

1. **API Key Missing**
   ```
   Error: GOOGLE_API_KEY not set
   ```
   Solution: Export the required environment variable

2. **Evalset Format Error**
   ```
   Error: Invalid evalset format
   ```
   Solution: Validate JSON structure matches schema

3. **Timeout**
   ```
   Error: Evaluation timed out
   ```
   Solution: Check network connectivity to external APIs

### Debug Mode

```bash
# Run with debug logging
ADK_DEBUG=1 adk eval --evalset hibiki.evalset.json
```

## CI Integration

Add to `.github/workflows/test.yml`:

```yaml
- name: Run ADK Eval
  env:
    GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
  run: |
    cd adk_agents/seichijunrei_bot
    adk eval --evalset hibiki.evalset.json
```

## Related Documents

- [Tool Error Contract](TOOL_ERROR_CONTRACT.md) - Tool response format
- [Session Model](../a2ui/SESSION_MODEL.md) - Session state management
- `adk_agents/seichijunrei_bot/_state.py` - State key definitions
