# Eval Redesign — Progress Log

## Session 2026-04-26

### Phase: Planning

- [x] Read current eval infrastructure (test_agent_eval.py, agent_eval_v2.json, eval_common.py)
- [x] Trace complete user flow from HTTP entry to response
- [x] Map all tool internal branches (resolve_anime, search_bangumi, etc.)
- [x] Identify 60 sub-paths from code analysis
- [x] Design new schema (acceptable_stages, context, metadata.db_state)
- [x] Research PydanticAI eval best practices (confirmed current approach is correct)
- [x] Explore translation chain (DB → Bangumi API → web/萌娘百科 → LLM)
- [x] Explore Bangumi API capabilities (search_subject supports ja/zh/en)
- [x] Identify language/locale verification gaps
- [x] Write findings document
- [x] Write formal task plan (task_plan.md)
- [x] Get user approval on plan

### Phase: Execution

- [x] Phase 1: Seed data expansion (executor agent — 7 anime + 14 points added)
- [x] Phase 2: Agent instruction update (executor agent — nearby + data freshness)
- [ ] Phase 3: Generate 600-case dataset (coder agent — in progress)
- [x] Phase 4: Evaluator + test file rewrite (done: 6 evaluators, context support, selected_route)
- [x] Phase 5: Delete stale baseline
- [ ] Phase 6: Verification (lint + test + eval run)

### Decisions Made
1. ~600 cases across 60 sub-paths (up from 546 across 6 paths)
2. `acceptable_stages` (list) replaces `expected_stage` (string)
3. Multi-turn tested via `context` injection
4. DB dimension as metadata tag, not separate test fixture
5. New ResponseLocale evaluator
6. Nearby flow: web_search → clarify (product logic change)
7. Agent instructions: add data freshness guidance
8. Translation eval (62 cases) stays separate — different layer
9. Bangumi API / 萌娘百科 as source of truth, DB as cache

### Blockers
None currently.
