# Seichijunrei — Greeting & Onboarding Design Spec

**Date:** 2026-04-02
**Status:** Design confirmed, pending implementation
**Type:** Focused feature spec
**Related canonical specs:**
- `docs/superpowers/specs/2026-03-31-seichijunrei-redesign-design.md`
- `docs/superpowers/specs/2026-04-01-frontend-memory-arch.md`

---

## 0. Why This Spec Exists

Two user-facing gaps remain even after the main redesign direction is in place:

1. **Cold start is too quiet.** When a user opens the app and has not sent a message yet, the chat panel shows only a faint placeholder. The right-side result panel already has atmosphere, but the left-side conversation area does not actively help the user start.
2. **Greeting messages are treated like unclear queries.** Inputs such as `hi`, `hello`, `你好`, `こんにちは`, or `你是谁` currently fall into the generic clarification path instead of receiving a proper introduction.

This spec adds a clear onboarding layer while preserving the architecture rule that the main runtime pipeline is for pilgrimage search and route planning.

---

## 1. Scope

This spec covers exactly two experiences:

1. **Empty-state onboarding in the chat panel**
2. **A formal backend `greet_user` intent for greetings and identity questions**

This spec does **not** redesign the full onboarding funnel, auth flow, memory system, or conversation persistence model.

---

## 2. Product Requirements

### 2.1 Empty State

When the user has sent no messages in the current UI session:

- The chat panel should show a lightweight onboarding card instead of only a placeholder line.
- The onboarding card should briefly explain what Seichijunrei is for.
- The onboarding card should offer 3 quick-start prompts, localized by `locale`.
- The onboarding card must be frontend-local only:
  - no backend request
  - no `session_id`
  - no persistence

The existing visual empty state in the result panel remains as the cinematic backdrop. The new chat onboarding card complements it; it does not replace it.

### 2.2 Greeting Intent

When the user sends a greeting or asks what the assistant is:

- The backend should recognize the message as a formal runtime intent: `greet_user`.
- The response should be written by the LLM in the user's locale.
- The answer should introduce Seichijunrei, explain its core capabilities, and suggest 2-3 example asks.
- This interaction must be **ephemeral**:
  - no conversation session created
  - no conversation history written
  - no request log written
  - no route history written
  - no memory / compact / persistence side effects

---

## 3. Non-Goals

- No full chatbot persona redesign
- No multi-turn small-talk mode
- No persistent "welcome conversation" seeded into history
- No separate greeting database table
- No additional UI renderer just for greeting; reuse existing answer-style rendering

---

## 4. UX Design

### 4.1 Empty Chat Panel

Current behavior:
- `MessageList` renders only a low-contrast placeholder string when `messages.length === 0`.

New behavior:
- Replace the plain placeholder with an onboarding card in the chat panel.
- The card should contain:
  - product name
  - one-sentence explanation
  - 3 localized quick actions
  - one subtle line that users can also say hello or ask what the assistant can do

Example zh copy direction:

> 我是圣地巡礼，可以帮你找动漫取景地、按地点探索附近场景、或者规划一条顺路巡礼路线。

Quick actions should feel task-oriented rather than marketing-oriented:
- Search by anime
- Search by location
- Ask for route planning

The card should submit the example query immediately when clicked.

### 4.2 Greeting Response

When the user sends `hi` or equivalent:

- The assistant replies in chat with a concise self-introduction.
- The reply is not special-cased visually; it is just a normal assistant text response.
- The right-side visual result panel does not need to open for a greeting.

Example zh response shape:

> 我是圣地巡礼，专门帮你查动漫取景地和安排行程。你可以让我按作品找场景、按地点看附近圣地，或者直接帮你排巡礼路线。比如你可以问我：“吹响吧！上低音号有哪些场景？”、“宇治站附近有什么取景地？”或者“从京都站出发排一条巡礼路线”。

Tone requirements:
- warm and concise
- practical, not overly role-played
- grounded in actual product capabilities
- no mention of internal tools, models, prompts, or databases

---

## 5. Runtime Design

### 5.1 New Tool Name

Add a new planner/executor tool:

```python
ToolName.GREET_USER = "greet_user"
```

Its step shape:

```python
PlanStep(
    tool=ToolName.GREET_USER,
    params={"message": "...localized greeting..."},
)
```

This mirrors the existing `answer_question(answer: str)` pattern, but keeps greeting behavior explicit and separately classifiable.

### 5.2 Planner Behavior

Update `PLANNER_SYSTEM_PROMPT` to describe `greet_user(message: str)`:

- Use it for greetings such as `hi`, `hello`, `你好`, `こんにちは`
- Use it for identity questions such as `你是谁`, `what are you`, `你能做什么`
- Do not use it for real pilgrimage queries, even if they begin with a greeting
  - Example: `你好，宇治站附近有哪些取景地？` should still become a real search plan, not greeting

Planner output rule:

- For pure greetings / identity asks: emit exactly one `greet_user` step
- Fill `params.message` with a localized introduction
- Keep the message to roughly 2-4 sentences

This means the greeting text is generated by the planner's existing LLM call. No extra LLM round-trip is required after planning.

### 5.3 Executor Behavior

`ExecutorAgent` adds `_execute_greet_user()`:

```python
return StepResult(
    tool="greet_user",
    success=True,
    data={"message": step.params.get("message", ""), "status": "info"},
)
```

`_build_output()` treats `greet_user` the same way it currently treats plain answer content:
- `message` comes from step data
- `status = "info"`
- no `results`
- no `route`

`_infer_primary_tool()` should include `ToolName.GREET_USER`.

### 5.4 Ephemeral Response Path

This is the most important architecture rule in the feature.

`greet_user` must be treated as an **ephemeral runtime response**, not a normal conversation turn.

In `RuntimeAPI.handle()`:

- run the normal pipeline
- inspect the resulting primary intent
- if the intent is `greet_user`, do **not**:
  - allocate a new session id
  - load or persist session state
  - append interactions
  - persist route history
  - write request logs

Public API response contract for ephemeral greeting:

```json
{
  "success": true,
  "status": "info",
  "intent": "greet_user",
  "session_id": null,
  "message": "...",
  "data": {},
  "session": {},
  "route_history": [],
  "ui": { "component": "GeneralAnswer", "props": {} }
}
```

This keeps frontend behavior simple:
- greeting shows as a normal assistant message
- no persistent session starts
- the next real search request can still start a fresh session

### 5.5 Mixed Queries

If the message contains both a greeting and a real task, the real task wins.

Examples:
- `hi` -> `greet_user`
- `你是谁` -> `greet_user`
- `你好，帮我找宇治站附近的场景` -> `search_nearby`
- `hello, plan a route for Your Name in Tokyo` -> `resolve_anime` + `search_bangumi` + `plan_route`

This prevents greeting detection from swallowing real intent.

---

## 6. Frontend Design

### 6.1 Message List Empty State

Replace the current empty-state placeholder in `MessageList.tsx` with a small onboarding card component.

Recommended contents:
- title: existing localized product name
- body: existing or slightly expanded welcome subtitle
- three clickable example prompts
- small helper line such as:
  - zh: `也可以先打个招呼，问我能帮你做什么。`
  - ja: `まずは挨拶して、何ができるか聞いてみても大丈夫です。`
  - en: `You can also just say hi and ask what I can help with.`

This card belongs in the chat column, not the result panel.

### 6.2 Result Panel Behavior

No new greeting-specific visual component is needed.

Greeting responses should behave like non-visual answer responses:
- remain in chat
- do not force-open the visual result panel
- reuse the same visual/non-visual routing logic being defined in frontend polish work

---

## 7. Prompt and Rule Priority

To avoid future confusion, this feature follows this priority order:

1. **Development-process rules** such as `using-superpowers`, `brainstorming`, and canonical specs govern how the team designs and implements the feature.
2. **Canonical product specs** define architecture boundaries.
3. **This focused greeting/onboarding spec** defines the greeting feature behavior.
4. **Runtime planner prompt rules** implement the feature at inference time.
5. **Session context and user message text** affect runtime behavior within the above constraints.

Important:
- `use superpowers` is a development workflow rule.
- It should **not** be inserted into the runtime system prompt for end-user conversations.

---

## 8. Proposed File Changes

| File | Change |
|---|---|
| `agents/models.py` | Add `ToolName.GREET_USER` |
| `agents/planner_agent.py` | Extend `PLANNER_SYSTEM_PROMPT` with `greet_user` rules |
| `agents/executor_agent.py` | Add `_execute_greet_user`, include in dispatch and output handling |
| `interfaces/public_api.py` | Add ephemeral intent handling for `greet_user`; skip session/log persistence |
| `frontend/components/chat/MessageList.tsx` | Replace empty placeholder with onboarding card |
| `frontend/lib/dictionaries/zh.json` | Add onboarding helper copy if needed |
| `frontend/lib/dictionaries/ja.json` | Add onboarding helper copy if needed |
| `frontend/lib/dictionaries/en.json` | Add onboarding helper copy if needed |
| `tests/unit/test_planner_agent.py` | Add greeting-plan tests |
| `tests/unit/test_executor_agent.py` | Add `greet_user` handler tests |
| `tests/unit/test_public_api.py` | Add ephemeral-response tests |
| `tests/frontend/*` or relevant component tests | Add empty-state onboarding rendering tests |

---

## 9. Testing Requirements

### 9.1 Planner

- `hi` -> single-step `greet_user`
- `你是谁` -> single-step `greet_user`
- `hello, find Hibike Euphonium spots` -> search plan, not greeting

### 9.2 Executor

- `greet_user` returns success with `message` and `status="info"`

### 9.3 Public API

- greeting responses return `session_id = null`
- greeting responses do not mutate session store
- greeting responses do not call `insert_request_log`
- greeting responses do not append route history

### 9.4 Frontend

- no-message state shows onboarding card
- clicking a suggestion calls `onSend`
- greeting response does not open visual result panel

---

## 10. Risks and Guardrails

### Risk 1: Greeting detection is too broad

If the planner starts mapping real search queries into `greet_user`, the product becomes less useful.

Guardrail:
- make mixed-query precedence explicit in the prompt
- add tests for greeting-plus-task inputs

### Risk 2: Greeting accidentally creates sessions

If `RuntimeAPI.handle()` still allocates session IDs before intent inspection, greeting responses will silently pollute history.

Guardrail:
- treat ephemeral intent handling as a first-class branch in the interface layer
- test `session_id is None` and verify no persistence calls fire

### Risk 3: Welcome copy diverges between frontend and greeting response

The frontend onboarding card and backend greeting text may drift apart.

Guardrail:
- align both around the same three core capabilities:
  - search by anime
  - search by location
  - plan a route

---

## 11. Rollout Order

1. Add backend `greet_user` intent and ephemeral runtime path
2. Add planner/executor/public API tests
3. Replace chat empty-state placeholder with onboarding card
4. Tune localized copy after the behavior is stable

This order keeps the product contract clear before UI polish.
