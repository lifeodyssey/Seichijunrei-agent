# Series-Aware Resolve + Grouped Display

## Feature Summary

When a user searches for an anime with multiple seasons/versions, the system uses Anitabi
real point data to determine whether those versions share the same pilgrimage area. Same-area
versions are merged into grouped results; different-area versions trigger a rich clarify card
with cover, city, point count, and map thumbnail so the user can pick a travel destination.

**Who:** Anime fans planning seichi junrei trips (ja/zh/en).
**Problem:** Bangumi API returns multiple results for most popular anime (S1/S2/S3/movie).
Currently the agent clarifies every time, even when all versions share the same area.
Users get asked "which season?" when they just want "all 響け spots in Uji."

## Primary User Action

Search an anime name → get useful pilgrimage results without unnecessary clarification.

## Design Direction

"Pilgrimage planning studio" — the merged view should feel like opening a comprehensive
guide book organized by work, with tab-switchable perspectives. The clarify card should
feel like a travel destination picker — cover + location + scale at a glance.

---

## Three Response Modes

### Mode A: Merge (same area, <15km between all candidates)

**Trigger:** All Bangumi candidates' Anitabi center geo within 15km of each other.

**Examples:** 響け S1/S2/S3 (2-7.5km), 凉宫 忧郁/消失 (3.6km), ぼっち S1/S2 (3.1km)

**User sees:**
- Series title + total point count + city
- Tab bar: 「作品別」「エリア別」「作品×エリア」
- Default view: grouped by work, each group collapsible
- Each point card shows: screenshot, location name, **work label**, episode number
- Points >500 → paginate / lazy-load within each group

**Data flow:**
```
resolve_anime(title)
  → Bangumi search → N candidates
  → For each: Anitabi /bangumi/{id} → get city + center geo
  → Haversine all pairs < 15km → action: "merge"
  → search_bangumi with ALL bangumi_ids
  → Results grouped by bangumi_id in response
```

### Mode B: Clarify with context (different areas, >15km)

**Trigger:** Any pair of candidates' center geo >15km apart.

**Examples:** LL S1 vs Sunshine (92km), ゆるキャン S1 vs S3 (71km)

**User sees:** Rich clarify cards, each containing:
- Cover image (from Anitabi)
- Work title (ja + user locale translation)
- City name
- Point count (from Anitabi pointsLength)
- Map thumbnail showing point distribution (Maps)
- Tappable → triggers search for that specific work

**Data flow:**
```
resolve_anime(title)
  → Bangumi search → N candidates
  → For each: Anitabi /bangumi/{id} → city + center + pointsLength + cover
  → Any pair > 15km → action: "clarify"
  → Return enriched candidates with geo data
  → Agent calls clarify() with enriched options
```

### Mode C: Standard clarify (ambiguous query, no clear series)

**Trigger:** User query is too vague (e.g., "凉宫" matching both Haruhi AND unrelated anime),
or Bangumi returns results from genuinely different series.

**How to distinguish B vs C:** Use Bangumi v0 relation API (`/v0/subjects/{id}/subjects`)
to check if candidates are related (续集/相同世界观/番外篇/总集篇). If related → same series
(apply geo distance check → Mode A or B). If unrelated → Mode C.

**Behavior:** Same as current clarify with enrichment. No change needed.

---

## Threshold: 15km

Validated against real Anitabi data:

| Distance | Examples | Verdict |
|---|---|---|
| <10km | 響け S1↔S3 (7.5km), 凉宫 (3.6km), ぼっち (3.1km) | Merge |
| 10-15km | けいおん S1↔S2 (12.8km), LL S1↔虹ヶ咲 (12.7km) | Merge (same-day reachable) |
| >15km | LL↔Sunshine (92km), ゆるキャン S1↔S3 (71km) | Clarify |

---

## Backend Changes

### 1. Anitabi Gateway: add `get_bangumi_info()`

**File:** `backend/infrastructure/gateways/anitabi.py`

New method calling `/bangumi/{id}` (NOT `/lite`, NOT `/points/detail`).
Returns: `{id, title, cn, city, geo: [lat,lng], cover, pointsLength, color}`.
Cache: 24h (same as Bangumi gateway).

### 2. resolve_anime handler: series-aware logic

**File:** `backend/agents/handlers/resolve_anime.py`

After Bangumi search returns N candidates:
1. For each candidate, call `anitabi.get_bangumi_info(bangumi_id)` (parallel, cached)
2. Compute pairwise haversine distances
3. If ALL pairs <15km → return `{"action": "merge", "bangumi_ids": [...], "series_title": "...", "city": "...", "candidates": [...]}`
4. If ANY pair >15km → return `{"action": "clarify", "candidates": [...with geo/city/points/cover...]}`
5. If Anitabi unavailable → fallback to current behavior (return ambiguous to agent)

### 3. search_bangumi: support multi-ID merge

**File:** `backend/agents/handlers/search_bangumi.py` + `_base_search.py`

Accept `bangumi_ids: list[str]` (plural). Execute retrieval for each ID (parallel),
merge results. Each result row tagged with `bangumi_id` for grouping.

### 4. Response models: add grouping

**File:** `backend/agents/runtime_models.py`

```python
class ResultGroupModel(BaseModel):
    bangumi_id: str
    title: str
    title_cn: str = ""
    point_count: int = 0

class ResultsMetaModel(BaseModel):
    # existing fields...
    groups: list[ResultGroupModel] = Field(default_factory=list)  # NEW
```

### 5. ClarifyResponseModel: enriched candidates

Existing `ClarifyCandidateModel` gets new fields:
```python
class ClarifyCandidateModel(BaseModel):
    title: str
    cover_url: str = ""
    spot_count: int = 0
    city: str = ""
    # NEW:
    center_lat: float = 0.0
    center_lng: float = 0.0
    color: str = ""  # Anitabi theme color
```

### 6. Agent instructions update

Add to `_INSTRUCTIONS`:
```
### Series-aware search
- When resolve_anime returns action="merge", call search_bangumi with ALL
  bangumi_ids — do not clarify. The system has already verified these are
  in the same area.
- When resolve_anime returns action="clarify", call clarify() with the
  enriched candidates. Include city and point count in the question.
```

---

## Frontend Changes

### 1. PilgrimageGrid: grouped display

**File:** `frontend/components/generative/PilgrimageGrid.tsx`

When `data.results.groups` is non-empty:
- Render tab bar: 「作品別」「エリア別」「作品×エリア」
- Each group: collapsible section with title + point count badge
- Each point card: add work label badge (e.g., "S1", "S3")
- Pagination: lazy-load when group has >50 points

### 2. Clarify cards: map thumbnail

**File:** `frontend/components/generative/ClarifyCard.tsx` (or within existing clarify component)

When candidate has `center_lat/center_lng`:
- Render static Maps thumbnail (~150x100px) showing the center point
- Use candidate's `color` as marker color

### 3. Types update

**File:** `frontend/lib/types/domain.ts`

Add `groups` to search result type, add geo fields to clarify candidate type.

---

## Fallback / Error Handling

| Scenario | Behavior |
|---|---|
| Anitabi API down | Fallback: use Bangumi `city` field for rough comparison. Same city string → merge. |
| Anitabi returns no geo | Treat as unknown → standard clarify |
| Only 1 Bangumi candidate | No change — direct search as today |
| All candidates have 0 points | Still apply geo logic — user may want to know the area even without DB points |
| >5 candidates | Only check top 5 by relevance (Bangumi search order) |

---

## Eval Impact

The eval dataset (`agent_eval_v3.json`) already has multi-season/remake cases.
After this change:
- A1 (exact_db_api_ok) cases where agent currently over-clarifies → should now merge → IntentMatch improves
- B3 (ambiguous_series) cases for same-area → acceptable_stages should include `search_bangumi`
- New cases needed for: merge behavior, clarify-with-context behavior, fallback behavior

---

## Multi-Turn Conversation Context (message_history)

### Problem

The PydanticAI agent is **stateless across turns**. `agent.run(text)` receives only
the current user message — no conversation history. The LLM cannot:
- Resolve references ("换一个", "附近还有吗", "帮我规划路线")
- Know what the user searched previously
- Understand it's continuing a conversation, not starting fresh

Current mitigation: `extract_context_delta()` saves structured fields (bangumi_id,
location, search_data, resolve_candidates) to session state, then seeds them into
`tool_state` on the next turn. This handles the clarify→select flow (fixed in this
iteration) but fails for natural language context ("show me a route for that anime").

### Solution: PydanticAI `message_history`

PydanticAI natively supports multi-turn via `message_history` parameter:

```python
result = await agent.run(
    text,
    deps=deps,
    message_history=previous_messages,  # NEW
)
# result.new_messages() → messages from this turn only
# result.all_messages() → previous + this turn
```

Serialization via official `ModelMessagesTypeAdapter`:

```python
from pydantic_ai import ModelMessagesTypeAdapter
from pydantic_core import to_jsonable_python

# Serialize (for session storage)
serialized = to_jsonable_python(result.new_messages())

# Deserialize (on next request)
messages = ModelMessagesTypeAdapter.validate_python(serialized)
```

### Implementation

#### 1. AgentResult: carry new_messages

**File:** `backend/agents/agent_result.py`

```python
from pydantic_ai.messages import ModelMessage

@dataclass
class AgentResult:
    output: RuntimeStageOutput
    steps: list[StepRecord] = field(default_factory=list)
    tool_state: dict[str, object] = field(default_factory=dict)
    new_messages: list[ModelMessage] = field(default_factory=list)  # NEW
```

#### 2. Runner: pass and capture message_history

**File:** `backend/agents/pilgrimage_runner.py`

```python
async def run_pilgrimage_agent(
    *,
    text: str,
    ...
    context: dict[str, object] | None = None,
    message_history: list[ModelMessage] | None = None,  # NEW
) -> AgentResult:
    ...
    run_result = await pilgrimage_agent.run(
        text,
        deps=deps,
        model=model,
        model_settings=model_settings,
        message_history=message_history or [],  # NEW
    )
    ...
    return AgentResult(
        output=raw_output,
        steps=list(deps.steps),
        tool_state=dict(deps.tool_state),
        new_messages=list(run_result.new_messages()),  # NEW
    )
```

#### 3. Session state: persist serialized messages

**File:** `backend/interfaces/session_facade.py`

Add `message_history` field to session state (serialized as JSON-compatible list).

```python
# In extract_context_delta — no change needed, message_history is
# persisted separately (not in context_delta).

# In build_updated_session_state — add to interaction:
interactions.append({
    "text": update.request.text,
    "intent": update.response_intent,
    ...
    "context_delta": update.context_delta or {},
    "new_messages": update.new_messages_serialized,  # NEW
})
```

Add top-level `message_history` to session state (accumulated from all interactions):

```python
# Rebuild full history from interactions
def build_message_history(session_state) -> list[object]:
    """Collect all serialized messages from interactions in order."""
    history = []
    for interaction in session_state.get("interactions", []):
        msgs = interaction.get("new_messages", [])
        if isinstance(msgs, list):
            history.extend(msgs)
    return history
```

#### 4. Public API: wire message_history through

**File:** `backend/interfaces/public_api.py`

```python
# In _load_session:
message_history = build_message_history(previous_state)
deserialized = ModelMessagesTypeAdapter.validate_python(message_history)

# In _execute_pipeline:
result = await run_pilgrimage_agent(
    text=request.text,
    ...
    context=context,
    message_history=deserialized,  # NEW
)
```

#### 5. Persistence: save new_messages to session

**File:** `backend/interfaces/persistence.py`

```python
# In persist_result — serialize and include in SessionUpdate:
from pydantic_core import to_jsonable_python

new_messages_serialized = (
    to_jsonable_python(result.new_messages) if result else []
)
```

### Guardrails

| Concern | Mitigation |
|---------|------------|
| Token explosion | Cap history at **last 10 interactions** (≈20 messages). Older ones are dropped. Agent instructions + tool_state still provide structured context for older state. |
| Large tool call payloads in history | PydanticAI messages include tool calls/results. These can be large (search results with 50+ points). Strip `ToolReturnPart.content` from messages older than 2 turns, keeping only tool name + success status. |
| Serialization size in session | Monitor session state size. If >100KB, trigger compaction (summarize old messages into a `SystemPromptPart`). |
| Backward compatibility | `message_history` defaults to `[]`. Existing sessions without it work as before — agent just has no history (current behavior). |

### Agent Instructions Update

Add to `_INSTRUCTIONS`:

```
### Conversation context
You have access to the conversation history from previous turns. Use it to:
- Understand references like "that anime", "show me a route", "换一个"
- Avoid re-clarifying when the user already selected an option
- Continue multi-step workflows (search → route) without re-asking
Do NOT repeat information the user has already seen.
```

---

## Eval V4 Redesign — Align with Best Practices

### Problem

Eval v3 has critical scoring bugs and is missing industry-standard practices:

1. **Task failures vanish from scoring** — `pydantic_evals` puts crashed cases in
   `report.failures` (separate from `report.cases`). Our error guard only checks
   `report.cases`, so 615/617 failures + 2 passes = "100%".
2. **No retry** — transient API errors immediately fail the case.
3. **No assertions** — all evaluators return `float`, losing pass/fail clarity.
4. **No LLM Judge** — response quality assessed only by deterministic checks.
5. **No partial credit** — IntentMatch is binary (0 or 1), no credit for related intents.
6. **No capability/regression split** — all cases in one bucket.
7. **Single-run only** — no pass@k consistency measurement.
8. **Baseline doesn't verify actual evaluated count** — can write "617 cases" when
   only 2 were actually scored.

References:
- [Anthropic: Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Braintrust: AI Agent Evaluation Framework](https://www.braintrust.dev/articles/ai-agent-evaluation-framework)
- [Pydantic Evals: Retry Strategies](https://ai.pydantic.dev/evals/how-to/retry-strategies/)
- [Pydantic Evals: LLM Judge](https://ai.pydantic.dev/evals/evaluators/llm-judge/)

### P0 — Eval results must be trustworthy

#### 1. Error guard: count `report.failures`

```python
# BEFORE (broken):
errored = sum(1 for c in report.cases if c.output is None)

# AFTER:
total = len(report.cases) + len(report.failures)
errored = len(report.failures)
error_rate = errored / total if total > 0 else 1.0
if error_rate > 0.20:
    pytest.fail(f"{errored}/{total} cases failed ({error_rate:.0%})")
```

#### 2. Baseline: record and verify `evaluated_count`

```python
# Write baseline with actual count:
{
    "case_count": 617,           # dataset size
    "evaluated_count": 617,      # cases that actually ran and scored
    "errored_count": 0,          # cases in report.failures
    "model": "...",
    "scores": { ... }
}

# Read baseline: reject if evaluated_count mismatch
baseline = read_baseline(...)
if baseline["evaluated_count"] < len(CASES) * 0.80:
    pytest.fail("Baseline was created with too few evaluated cases")
```

#### 3. Add `retry_task` for transient errors

```python
from tenacity import stop_after_attempt, wait_exponential

report = await agent_dataset.evaluate(
    task,
    retry_task={
        'stop': stop_after_attempt(2),
        'wait': wait_exponential(min=1, max=5),
    },
    max_concurrency=20,  # reduce from 50 to avoid rate limits
)
```

### P1 — Align with best practices

#### 4. Evaluators: assertions (bool) vs scores (float)

| Evaluator | Current | Target | Rationale |
|-----------|---------|--------|-----------|
| IntentMatch | float (0/1) | **bool assertion** | Hard requirement: correct intent or not |
| ToolExecution | float (0/1) | **bool assertion** | Hard requirement: called required tools |
| MessageQuality | float (0/1) | **bool assertion** | Message must exist and have min length |
| ResponseLocale | float (0/1) | **bool assertion** | Must reply in correct language |
| DataCompleteness | float (0/1) | **float score** | Soft: partial data still useful |
| StepEfficiency | float (0/0.5/1) | **float score** | Soft: 1 extra step is acceptable |

Assertions show ✔/✗ in report, auto-aggregate as pass rate.

#### 5. Partial credit for IntentMatch

```python
class IntentMatch(Evaluator):
    # Full score weights
    _RELATED: dict[str, set[str]] = {
        "search_bangumi": {"clarify"},   # clarify when search expected = partial
        "clarify": {"search_bangumi"},   # searched when clarify expected = partial
    }

    def evaluate(self, ctx) -> float:
        actual = ctx.output.intent
        acceptable = ctx.expected_output.acceptable_stages
        if actual in acceptable:
            return 1.0
        # Partial credit for related intent
        for stage in acceptable:
            if actual in self._RELATED.get(stage, set()):
                return 0.5
        return 0.0
```

Keep the boolean assertion version for hard pass/fail, add a separate
`IntentRelevance` score evaluator for partial credit.

#### 6. LLM Judge evaluator

```python
from pydantic_evals.evaluators import LLMJudge

agent_dataset = Dataset(
    evaluators=[
        # Deterministic (assertions)
        IntentMatch(),
        ToolExecution(),
        MessageQuality(),
        ResponseLocale(),
        # Deterministic (scores)
        DataCompleteness(),
        StepEfficiency(),
        # LLM Judge (score) — new
        LLMJudge(
            rubric='''
            Evaluate whether the agent response is helpful for an anime
            pilgrimage planner:
            1. Does it provide actionable location information?
            2. Is the response in the correct language?
            3. Does it avoid fabricated locations or coordinates?
            4. For clarify responses: are the options relevant and clear?
            ''',
            include_input=True,
            include_expected_output=True,
            score={'evaluation_name': 'response_quality'},
            model='openai:gpt-5.5',  # cheap judge model
        ),
    ],
)
```

### P2 — Advanced patterns

#### 7. Capability vs regression eval split

```python
# In agent_eval_v3.json, add "eval_tier" field:
{
    "id": "A1_ja_001",
    "eval_tier": "regression",  # or "capability"
    ...
}

# Split datasets:
REGRESSION_CASES = [c for c in CASES if c.metadata.get("eval_tier") == "regression"]
CAPABILITY_CASES = [c for c in CASES if c.metadata.get("eval_tier") == "capability"]

# Regression: gate at baseline (must not drop)
# Capability: track scores but don't gate (expected to improve over time)
```

Start by marking current high-pass-rate cases as "regression" and
the known-failing cases (over-clarify, wrong locale) as "capability".

#### 8. pass@k consistency measurement

```python
report = await agent_dataset.evaluate(
    task,
    repeat=3,  # Run each case 3 times
    max_concurrency=20,
)
# pydantic_evals auto-groups by case name and computes per-case pass rate
# pass@3: at least 1 of 3 succeeded
# pass^3: all 3 succeeded (consistency)
```

Report both metrics. Gate on pass@3 for capability, pass^3 for regression.

#### 9. Case-specific evaluators

```python
Case(
    name='greeting_ja',
    inputs=AgentInput(query='こんにちは', locale='ja'),
    expected_output=AgentExpected(acceptable_stages=['greet_user']),
    evaluators=[
        LLMJudge(
            rubric='Greeting is warm, mentions what the app can do, in Japanese.',
            include_input=True,
            score={'evaluation_name': 'greeting_quality'},
        ),
    ],
),
Case(
    name='search_eupho',
    inputs=AgentInput(query='響けユーフォニアム 聖地', locale='ja'),
    expected_output=AgentExpected(
        acceptable_stages=['search_bangumi'],
        data_keys=['results'],
    ),
    evaluators=[
        LLMJudge(
            rubric='Results mention Uji (宇治) and include real locations.',
            include_input=True,
            assertion={'evaluation_name': 'location_grounded'},
        ),
    ],
),
```

#### 10. Transcript review workflow

Save full agent transcript (tool calls, LLM responses, timing) per case:

```python
case_data["transcript"] = [
    {
        "tool": s.tool,
        "params": s.params,
        "success": s.success,
        "data_preview": str(s.data)[:200] if s.data else None,
    }
    for s in cr.output.steps
]
```

Add a review command: `make eval-review` that opens the per-case results
JSON in a formatted viewer, sorted by lowest scores first.

### Implementation Order

| Phase | Items | Depends on |
|-------|-------|------------|
| **Phase 1** | P0 #1-3 (error guard + baseline + retry) | None |
| **Phase 2** | P1 #4-5 (assertions + partial credit) | Phase 1 |
| **Phase 3** | P1 #6 (LLM Judge) | Phase 2 |
| **Phase 4** | P2 #7-8 (capability/regression + pass@k) | Phase 2 |
| **Phase 5** | P2 #9-10 (case-specific + transcript review) | Phase 3 |

---

## Open Questions

1. Maps provider for static thumbnails — MapTiler (free tier) vs Mapbox vs OSM static?
2. Should merge search run all Anitabi detail fetches in parallel or sequential?
3. "作品×エリア" tab — what granularity for "area"? Sub-city neighborhoods or broader?
4. Message history cap — 10 interactions enough? Or should we use token counting?
5. LLM Judge model — use same model as agent (conflict of interest) or a different one?
6. pass@k repeat count — 3 enough for consistency signal or need 5?
