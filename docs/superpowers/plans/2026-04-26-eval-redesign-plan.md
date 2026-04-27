# Eval Redesign — Task Plan

> **Goal:** Replace the 546-case eval dataset (IntentMatch 37%) with a ~600-case dataset
> covering 60 sub-paths derived from code analysis, fix nearby product logic, add
> multi-turn/translation/DB-dimension/adversarial coverage, switch to `acceptable_stages`
> schema, and add locale verification.

## Phases

### Phase 1: Seed Data Expansion
**File:** `backend/tests/fixtures/seed.sql`
**Depends on:** nothing

Add 7 anime + 14 points to the test fixture (current: 7 anime, 18 points → 14 anime, 32 points).

New anime (2 points each):
| bangumi_id | title | title_cn | city |
|---|---|---|---|
| 378862 | ぼっち・ざ・ろっく！ | 孤独摇滚！ | 東京都 |
| 404804 | 【推しの子】 | 我推的孩子 | 東京都 |
| 396387 | SPY×FAMILY | 间谍过家家 | 東京都 |
| 328609 | ゆるキャン△ | 摇曳露营 | 山梨県 |
| 403172 | THE FIRST SLAM DUNK | 灌篮高手 | 神奈川県 |
| 1482 | らき☆すた | 幸运星 | 埼玉県 |
| 36954 | 氷菓 | 冰菓 | 岐阜県 |

**Verification:** `make test-integration` — seed loads without error.

---

### Phase 2: Agent Instruction Update
**File:** `backend/agents/pilgrimage_agent.py` (lines 59-93)
**Depends on:** nothing (parallel with Phase 1)

#### 2a. Replace nearby search instructions (lines 59-62)

**Before:**
```
### Location/nearby search
- Call search_nearby(location, radius) when the user mentions a place name
- Do NOT call resolve_anime for location queries
```

**After:**
```
### Location/nearby search
- When the user mentions a place name without a specific anime title
  (e.g., "宇治附近", "spots near Kamakura", "京都有什么圣地"):
  1. Call web_search("<location> anime pilgrimage 聖地巡礼 アニメ")
  2. Compile anime list from web results + your knowledge
  3. Call clarify() with the anime options
  4. After user picks → resolve_anime → search_bangumi
- Exception: query has both anime AND location → resolve anime directly
- Do NOT call search_nearby for bare location queries — clarify first
```

#### 2b. Add data freshness section (after line 93)

```
### Data freshness
- Our database may be incomplete or outdated. Consider web_search when:
  - DB returned ≤2 points for a popular anime
  - Recent anime (2024+)
  - You're uncertain about completeness
- Enrich response: "there are also reported spots at X not in our database"
```

#### 2c. Update examples (lines 84-93)

```
User: "宇治站附近" → web_search("宇治 anime 聖地巡礼") → clarify(ユーフォ etc.)
User: "京都有什么圣地" → web_search("京都 アニメ 聖地巡礼") → clarify(...)
User: "西宮の涼宮聖地" → resolve_anime("涼宮") → search_bangumi()
```

**Verification:** `make lint && make typecheck` pass. Manual test with a few queries.

---

### Phase 3: New Eval Dataset
**File:** `backend/tests/eval/datasets/agent_eval_v3.json` (NEW)
**Depends on:** Phase 1 (need seed anime list), Phase 2 (need new expected behavior)

#### Schema

```json
{
  "id": "A1_ja_001",
  "path": "exact_db_api_ok",
  "tier": "happy|edge|adversarial",
  "query": "ぼっち・ざ・ろっく！の聖地を教えて",
  "locale": "ja",
  "acceptable_stages": ["search_bangumi"],
  "expected_data_keys": ["results"],
  "context": null,
  "selected_point_ids": null,
  "metadata": {
    "anime": "ぼっち・ざ・ろっく！",
    "bangumi_id": "378862",
    "db_state": "hit_complete",
    "difficulty": "easy",
    "notes": ""
  }
}
```

Key differences from v2:
- `acceptable_stages` (list) replaces `expected_stage` (string)
- `context` field for multi-turn (maps to `run_pilgrimage_agent(context=...)`)
- `selected_point_ids` for K-path (agent bypass)
- `metadata.db_state`: hit_complete / hit_sparse / miss / not_found / none
- `path` field for grouping/analysis

#### Path distribution (~600 cases)

| Group | Paths | Cases | % |
|---|---|---|---|
| A. Core search | A1-A10 | 140 | 23% |
| B. Ambiguity | B1-B4 | 60 | 10% |
| C. Nearby | C1-C4 | 50 | 8% |
| D. Route | D1-D4 | 50 | 8% |
| E. Greeting | E1-E4 | 30 | 5% |
| F. QA | F1-F3 | 30 | 5% |
| G. Multi-turn | G1-G6 | 60 | 10% |
| H. Context | H1-H4 | 35 | 6% |
| I. Translation | I1-I9 | 60 | 10% |
| J. Edge | J1-J5 | 35 | 6% |
| K. Selected route | K1-K4 | 15 | 3% |
| L. Adversarial | L1-L4 | 25 | 4% |
| **Total** | **60** | **~590** | |

See `findings.md` for detailed sub-path definitions.

**Verification:** JSON valid, all referenced anime in seed.sql, all `acceptable_stages` values are valid intents.

---

### Phase 4: Evaluator + Test File Update
**File:** `backend/tests/eval/test_agent_eval.py`
**Depends on:** Phase 3 (need v3 schema)

#### 4a. Simplify AgentExpected

```python
@dataclass
class AgentExpected:
    acceptable_stages: list[str]
    data_keys: list[str]
    message_min_len: int = 2
```

Drop: `results_keys`, `route_keys`, `nearby_fields` (unused by evaluators).

#### 4b. Add context to AgentInput

```python
@dataclass
class AgentInput:
    query: str
    locale: str
    context: dict[str, object] | None = None
    selected_point_ids: list[str] | None = None
```

#### 4c. Update make_agent_task

Branch on `selected_point_ids` to call `execute_selected_route()` for K-path cases.
Pass `context` to `run_pilgrimage_agent()`.

#### 4d. Fix IntentMatch evaluator

```python
return 1.0 if ctx.output.intent in ctx.expected_output.acceptable_stages else 0.0
```

#### 4e. Fix ToolExecution evaluator

```python
no_tool = {"greet_user", "general_qa"}
if ctx.expected_output and no_tool.intersection(ctx.expected_output.acceptable_stages):
    return 1.0
```

#### 4f. Fix StepEfficiency — use `acceptable_stages[0]`

#### 4g. Add ResponseLocale evaluator

```python
class ResponseLocale(Evaluator[AgentInput, AgentResult]):
    """1.0 if agent message language matches requested locale."""
    def evaluate(self, ctx):
        if ctx.output is None: return 0.0
        detected = detect_language(ctx.output.message)
        return 1.0 if detected == ctx.inputs.locale else 0.0
```

#### 4h. Update _load_cases — point to v3, parse new fields

#### 4i. 6 evaluators total

IntentMatch, MessageQuality, ToolExecution, DataCompleteness, StepEfficiency, ResponseLocale.

**Verification:** `make lint && make typecheck`. File stays under 300 lines (1-10-50 rule).

---

### Phase 5: Baseline Reset
**Depends on:** Phase 4

- Delete: `backend/tests/eval/baselines/agent_openai-deepseek-v4-pro-https---api.deepseek.com.json`
- Keep: `translation_translation.json`

---

### Phase 6: Verification
**Depends on:** all previous phases

1. `make lint && make typecheck`
2. `make test` — unit tests pass
3. `make test-integration` — seed data loads correctly
4. Run eval:
   ```bash
   uv run python backend/tests/eval/test_agent_eval.py \
     --eval-model openai:deepseek-v4-pro@https://api.deepseek.com
   ```
5. First run creates baseline. Expected: IntentMatch >> 37%.
6. Second run verifies gate enforcement.

---

## Files Changed

| File | Action | Lines |
|---|---|---|
| `backend/tests/fixtures/seed.sql` | MODIFY | +~30 |
| `backend/agents/pilgrimage_agent.py` | MODIFY | ~20 lines changed |
| `backend/tests/eval/datasets/agent_eval_v3.json` | CREATE | ~12000 |
| `backend/tests/eval/test_agent_eval.py` | MODIFY | ~50 lines changed |
| `backend/tests/eval/baselines/agent_*.json` | DELETE | — |

## Files NOT Changed

| File | Reason |
|---|---|
| `agent_eval_v2.json` | Keep as reference |
| `eval_common.py` | Types not used by test_agent_eval |
| `test_translation.py` + `translation_v1.json` | Separate layer, PydanticAI-compliant |
| `pilgrimage_tools.py` | web_search tool already exists |

## Execution Order

```
Phase 1 (seed.sql) ──────┐
                          ├─→ Phase 3 (agent_eval_v3.json)
Phase 2 (instructions) ───┘         │
                                    ├─→ Phase 4 (test_agent_eval.py)
                                    ├─→ Phase 5 (delete baseline)
                                    └─→ Phase 6 (verify)
```

Phases 1+2 parallel. Phase 3 depends on both. Phases 4+5 depend on 3.
