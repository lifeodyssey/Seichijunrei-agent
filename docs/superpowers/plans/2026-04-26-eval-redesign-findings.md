# Eval Redesign — Research Findings

## 1. Current State

### Eval Infrastructure
- **Framework:** PydanticAI native `Dataset` + `Case` + `Evaluator` (符合官方推荐)
- **Dataset:** `agent_eval_v2.json` — 546 cases, schema: `{id, query, locale, expected_stage, expected_data_keys, metadata}`
- **Translation eval:** `translation_v1.json` — 62 cases, tests `translate_title()` 4-step chain
- **Evaluators (5):** IntentMatch, MessageQuality, ToolExecution, DataCompleteness, StepEfficiency
- **Baseline:** DeepSeek V4 Pro: IntentMatch 37%, DataCompleteness 45%, ToolExec 99%, MessageQuality 100%
- **Runner:** `test_agent_eval.py` (377 lines), SUT = `run_pilgrimage_agent()`, 50 concurrency, 120s timeout
- **Seed data:** 7 anime, 18 points in `seed.sql`

### Why Scores Are Low
- 546 cases use single `expected_stage` — many labels wrong (agent legitimately returns different intent)
- No multi-turn, translation, adversarial, or DB-dimension paths
- Nearby search logic assumes raw geo search, but product should clarify first
- Distribution: search_bangumi 178, plan_route 103, clarify 97, search_nearby 73, general_qa 51, greet_user 44

## 2. Complete User Flow (from code)

### Entry: `RuntimeAPI.handle()` (public_api.py:91)
```
request → guardrail → load session + context
  ├─ selected_point_ids → execute_selected_route() [BYPASS AGENT]
  └─ text → run_pilgrimage_agent() → translation_gate → response
       ├─ greet_user → no session, early return
       └─ other → persist session + result
```

### Agent Decision Tree (pilgrimage_agent.py instructions + tools)
```
query
├─ greeting → greet_user() → GreetingResponseModel
├─ QA → general_qa() → QAResponseModel
├─ anime title → resolve_anime(title)
│   resolve always queries DB + Bangumi API (GET /search/subject/{keyword})
│   Bangumi API supports ja/zh/en, returns name(ja) + name_cn(zh)
│   ├─ single match + specific query → search_bangumi(id)
│   ├─ single match + vague query → clarify(candidates)
│   ├─ multiple matches → clarify(candidates)
│   ├─ API only (DB miss) → write-through + search
│   ├─ nothing found → error / web_search
│   └─ after resolve:
│       ├─ search only → search_bangumi → SearchResponseModel
│       │   DB has points → return
│       │   DB empty → Anitabi API fetch + write-through → return
│       └─ route → search_bangumi → plan_route → RouteResponseModel
├─ location (no anime) → web_search → clarify → [user picks] → search
├─ needs translation → translate_anime_title (DB→API→web(萌娘百科)→LLM) → resolve
└─ mixed/unclear → agent judgment
```

### Tool Internal Branches

**resolve_anime:** DB lookup + Bangumi API search → merge/dedup → 0/1/N candidates
**search_bangumi:** SQL/HYBRID strategy → DB rows (empty → Anitabi fetch)
**search_nearby:** GEO strategy → PostGIS proximity (5km default)
**plan_route:** requires search data → optimize_route (nearest-neighbor) → timed_itinerary
**clarify:** question + options → enrich_clarify_candidates (cover/count/city)
**web_search:** DuckDuckGo DDGS.text (5 results, 10s timeout)
**translate_anime_title:** 4-step chain (DB → Bangumi API → web(萌娘百科/Wikipedia) → LLM)
**selected_route:** get_points_by_ids → optimize_route (agent bypass)

### Translation Architecture
```
Agent tool: translate_anime_title → translate_title()
  Step 1: DB cache (title/title_cn) — confidence 1.0
  Step 2: Bangumi API (name/name_cn) — confidence 0.9
  Step 3: Web search (萌娘百科/Wikipedia via DuckDuckGo) — confidence 0.7
  Step 4: LLM fallback — confidence 0.3

Post-agent: _apply_translation_gate (public_api.py:346-370)
  detect_language(message) → if != locale → translate_text(message, target=locale)
```

### Language/Locale Issues
- Data fields: `title`(ja) + `title_cn`(zh), no `title_en`
- Agent message: LLM generates in user locale (instruction says so)
- translation_gate: detects mismatch → translates message only (not data)
- Clarify candidates: show title from DB/API, may not match user locale

## 3. Derived Eval Paths (60 sub-paths)

### A. Core Search (10 sub-paths, ~140 cases)
A1: DB+API OK → search → rows (most common)
A2: DB sparse (≤2 points) → search → few rows
A3: API only (DB miss) → write-through → search
A4: Nothing found → error/web_search
A5: API multi candidates → clarify
A6: API fail → DB-only degraded
A7: Needs translation → translate chain → resolve
A8: locale=ja (title naturally matches)
A9: locale=zh (needs title_cn)
A10: locale=en (no title_en field)

### B. Ambiguity/Clarify (4 sub-paths, ~60 cases)
B1: Multi-match from resolve
B2: Short/vague query → should clarify even if single match
B3: Multi-series (fate, ラブライブ, ガンダム)
B4: Descriptive query ("the anime with shrine stairs")

### C. Nearby/Geo (4 sub-paths, ~50 cases)
C1: Bare location → web_search → clarify (NEW flow)
C2: City-level → web_search → clarify
C3: Location + anime name → direct resolve
C4: Unknown location → geocode fail

### D. Route Planning (4 sub-paths, ~50 cases)
D1: From search results (standard 3-step)
D2: With origin station
D3: Few points (<2) → can't plan
D4: DB miss → no points → can't plan

### E. Greeting (4 sub-paths, ~30 cases)
E1: Pure greeting (no session created)
E2: Greeting + real query → ignore greeting
E3: Thanks/goodbye
E4: Identity query

### F. QA (3 sub-paths, ~30 cases)
F1: Pilgrimage etiquette/tips
F2: Travel planning/costs/transport
F3: General anime QA

### G. Multi-turn (6 sub-paths, ~60 cases)
G1: Clarify then search (user selects)
G2: Search then route (context: last_search_data)
G3: Switch anime (context: previous search)
G4: Ask nearby after search (context: location)
G5: Continue/expand search
G6: Refine route (add origin)

### H. Context-aware (4 sub-paths, ~35 cases)
H1: With GPS → nearby
H2: With GPS → route origin
H3: With session data → reuse results
H4: With last_location → route origin

### I. Translation+Language (9 sub-paths, ~60 cases)
I1: CN title → translate(DB/萌娘百科) → resolve
I2: EN title → Bangumi API direct
I3: EN cold title → web search(Wikipedia)
I4: Mixed language query
I5: Ask for translation → QA
I6: Cross-locale search
I7: Message locale verification
I8: Clarify candidates locale
I9: Translation confidence check

### J. Cross-language/Edge (5 sub-paths, ~35 cases)
J1: Query lang ≠ locale
J2: Romanized title
J3: Abbreviation
J4: Typo
J5: Partial title

### K. Selected Route (4 sub-paths, ~15 cases)
K1: Normal selection
K2: With origin
K3: Empty IDs
K4: Invalid IDs

### L. Adversarial (4 sub-paths, ~25 cases)
L1: Prompt injection
L2: Irrelevant topic
L3: Empty input
L4: Extremely long input

## 4. Key Design Decisions

### Schema: `acceptable_stages` replaces `expected_stage`
Many queries can legitimately result in multiple intents. E.g., "宇治附近有什么" could be search_nearby OR clarify.

### Multi-turn via `context` field
`run_pilgrimage_agent(context=...)` already supports injecting previous state. Case `context` field maps directly.

### DB dimension as metadata tag
`metadata.db_state`: hit_complete / hit_sparse / miss / not_found / none

### New evaluator: ResponseLocale
Verifies agent message language matches requested locale.

### Translation eval stays separate
`test_translation.py` (62 cases) tests `translate_title()` function quality — different layer from agent eval.

## 5. Files to Change

| File | Change Type | Description |
|---|---|---|
| `backend/tests/fixtures/seed.sql` | MODIFY | Add 7 anime + 14 points |
| `backend/agents/pilgrimage_agent.py` | MODIFY | Nearby instructions + data freshness |
| `backend/tests/eval/datasets/agent_eval_v3.json` | CREATE | ~600 cases, new schema |
| `backend/tests/eval/test_agent_eval.py` | MODIFY | New schema, evaluators, context support |
| `backend/tests/eval/baselines/agent_*.json` | DELETE | Stale baseline |
