# Layered Eval Harness

## Context

The original design spec (`docs/superpowers/specs/2026-04-10-layered-eval-architecture-design.md`) proposed a 4-layer eval pyramid for the Seichijunrei ReAct agent. That spec is DRAFT with 0% implementation. This harness-compliant spec rewrites it with mandatory AC categories, test type annotations, and a concrete task breakdown suitable for the Coordinator to plan execution.

**Current state:** One eval layer exists (`backend/tests/eval/test_plan_quality.py`) running 163 cases through the full `run_pipeline()` path with a testcontainer DB. It takes 1-2 hours, burns model quota, and provides no isolation between intent classification, planner reasoning, executor dispatch, and database failures. The existing baseline (`baselines/gemini-2.5-pro.json`) shows StepsMatch at 45%, IntentMatch at 60%, Outcome at 37%, Efficiency at 88%.

**Trigger:** Need faster feedback loops for prompt iteration. A planner prompt change currently requires a 1-2 hour pipeline eval to validate. With the layered pyramid, Layer 1b validates in 3-5 minutes.

## Goals

1. Ship `eval_common.py` shared infrastructure (dataset loader, baseline management, gate enforcement, model precheck, per-case progress, per-case timeout)
2. Ship Layer 1a: deterministic component eval (intent classifier + output_validator) running 163 cases in under 10 seconds with zero LLM calls
3. Ship Layer 1b: single-LLM planner eval testing first-step tool selection, running 163 cases in under 5 minutes
4. Ship Layer 2: multi-LLM ReAct loop eval testing convergence, step sequence, and efficiency with fixture-based mock DB, running 163 cases in under 20 minutes
5. Refactor existing Layer 3 (`test_plan_quality.py`) to extract shared code into `eval_common.py`
6. Wire Makefile targets for independent and combined layer execution
7. Add Layer 1a (`test-eval-components`) to `make test` since it has zero external dependencies

## Non-Goals

- New eval dataset creation (reuse existing 163-case `plan_quality_v1.json`)
- Concurrency (`max_concurrency > 1`) -- start serial, add later
- Model-based grading (LLM-as-judge) in Layers 1-2 -- code-based evaluators only
- `inject_failure` cases for Layer 2 failure recovery -- deferred to a follow-up iteration
- Changes to `test_api_e2e.py` or `cases/intent_cases.json` (existing, separate)
- Frontend eval or browser-based testing
- pass@k / pass^k multi-trial execution -- deferred

## Architecture

### Eval pyramid (target state)

```
                    +-------------------+
                    |   Layer 3:        |  CI-only, hours
                    |   Pipeline eval   |  run_pipeline() e2e
                    |   (EXISTING)      |  testcontainer DB
                    +--------+----------+
                             |
                    +--------+----------+
                    |   Layer 2:        |  ~15 min, multi-LLM
                    |   ReAct eval      |  react_loop() full
                    |   (NEW)           |  fixture mock DB
                    +--------+----------+
                             |
              +--------------+--------------+
              |                             |
    +---------+----------+     +------------+---------+
    |   Layer 1b:        |     |   Layer 1a:          |
    |   Planner eval     |     |   Component eval     |
    |   (NEW)            |     |   (NEW)              |
    |   1 LLM call/case  |     |   No LLM, seconds    |
    +--------------------+     +-----------------------+
```

### File structure (changes only)

```
backend/tests/eval/
  eval_common.py              <-- NEW: shared infrastructure
  test_component_quality.py   <-- NEW: Layer 1a (deterministic)
  test_planner_quality.py     <-- NEW: Layer 1b (single LLM call)
  test_react_quality.py       <-- NEW: Layer 2 (multi-LLM, react_loop)
  test_plan_quality.py        <-- MODIFIED: extract shared code to eval_common
  baselines/
    component-deterministic.json  <-- NEW: Layer 1a baseline (model-independent)
    planner-*.json                <-- NEW: Layer 1b baselines (per-model)
    react-*.json                  <-- NEW: Layer 2 baselines (per-model)
Makefile                      <-- MODIFIED: add new targets
```

### Key design decisions

1. **Shared dataset:** All layers read `plan_quality_v1.json` (163 cases). No per-layer datasets.
2. **Layer 1a baseline ID:** Uses `"deterministic"` as sentinel model ID since results are model-independent.
3. **Layer 2 mock DB:** Fixture-based mock returning realistic data keyed by case content. Real DB stays in Layer 3 only.
4. **Output validator testing:** The `@agent.output_validator` in `planner_agent.py` is tested by constructing `ReActDeps` with `Observation` history and invoking the validator logic directly. This requires extracting the validator body into a standalone async function that the decorator calls -- or replicating the logic in the test.
5. **Gate tolerance:** All layers use `>= baseline - 10pp` gate, matching the existing Layer 3 behavior.
6. **Makefile pattern:** New targets use `$(PYTEST)` (expands to `.venv/bin/python -m pytest`), consistent with existing targets.

## Task Breakdown

### Task 1: Shared eval infrastructure (eval_common.py)

- **Scope:** Create `backend/tests/eval/eval_common.py` with dataset loader, model precheck, baseline read/write, gate enforcement, progress callback, and per-case timeout constant. Extract duplicated logic from `test_plan_quality.py` (lines 223-368: dataset loading, baseline management, gate enforcement).
- **Files changed:**
  - `backend/tests/eval/eval_common.py` (CREATE)
  - `backend/tests/eval/test_plan_quality.py` (MODIFY: import from eval_common instead of inline implementations)
- **AC (with mandatory categories):**
  - [ ] Happy path: `load_dataset()` returns 163 typed `EvalCase` objects with all required fields (`id`, `query`, `locale`, `expected_steps`, `expected_intent`) -> unit
  - [ ] Happy path: `read_baseline("component", "deterministic")` returns stored scores dict when baseline file exists -> unit
  - [ ] Happy path: `write_baseline("planner", "gemini-2.5-pro", scores, case_count=163)` creates `baselines/planner-gemini-2.5-pro.json` with correct structure -> unit
  - [ ] Happy path: `enforce_gate(current, baseline, tolerance=0.10)` returns empty failures list when all current scores >= baseline - 10pp -> unit
  - [ ] Null/empty: `load_dataset()` raises clear error when `plan_quality_v1.json` is missing or empty -> unit
  - [ ] Null/empty: `read_baseline()` returns empty dict `{}` when baseline file does not exist -> unit
  - [ ] Null/empty: `read_baseline()` returns empty dict when stored `case_count` mismatches current dataset size (stale baseline detection) -> unit
  - [ ] Error path: `enforce_gate()` returns list of failure strings when current score < baseline - tolerance for any evaluator -> unit
  - [ ] Error path: `precheck_model()` raises descriptive error when model is unreachable (auth, quota, network) -> unit
  - [ ] Error path: Refactored `test_plan_quality.py` still passes with `make test-eval` unchanged -> integration

### Task 2: Layer 1a -- Component eval (deterministic)

- **Scope:** Create `backend/tests/eval/test_component_quality.py` testing `classify_intent()` from `backend/agents/intent_classifier.py` and the output_validator logic from `backend/agents/planner_agent.py` against all 163 cases. Zero LLM calls. Runs in seconds.
- **Files changed:**
  - `backend/tests/eval/test_component_quality.py` (CREATE)
  - `Makefile` (MODIFY: add `test-eval-components` target)
- **AC (with mandatory categories):**
  - [ ] Happy path: `IntentClassifierAccuracy` evaluator scores 1.0 for each case where `classify_intent(query, locale)` returns matching `expected_intent` -> unit
  - [ ] Happy path: `ValidatorBehavior` evaluator scores 1.0 for positive scenario -- all prerequisites in history complete, valid `DoneSignal` accepted by validator logic -> unit
  - [ ] Happy path: `ValidatorBehavior` evaluator scores 1.0 for negative scenario -- missing prerequisite step, premature done raises `ModelRetry` -> unit
  - [ ] Happy path: Full 163-case run completes in under 10 seconds -> unit
  - [ ] Happy path: First run creates `baselines/component-deterministic.json`, second run enforces gate -> unit
  - [ ] Null/empty: Cases where `classify_intent` returns `AMBIGUOUS` (confidence < 0.7) are scored 0.0, not skipped -> unit
  - [ ] Null/empty: Cases with only 1 expected_step (e.g. `["greet_user"]`) skip the negative validator scenario since no prerequisite can be violated -> unit
  - [ ] Error path: Validator correctly raises `ModelRetry` when ANIME_SEARCH intent signals done without prior `search_bangumi` observation in history -> unit
  - [ ] Error path: Validator correctly raises `ModelRetry` when ROUTE_PLAN intent signals done without prior `plan_route` observation despite having `search_bangumi` -> unit
  - [ ] Error path: `make test-eval-components` exits non-zero on regression below baseline - 10pp -> unit

### Task 3: Layer 1b -- Planner eval (single LLM call)

- **Scope:** Create `backend/tests/eval/test_planner_quality.py` testing `ReActPlannerAgent.step()` with empty history for each case. One LLM call per case. Evaluates first-step tool selection and thought quality. Uses `classify_intent()` to populate `classified_intent` for each case.
- **Files changed:**
  - `backend/tests/eval/test_planner_quality.py` (CREATE)
  - `Makefile` (MODIFY: add `test-eval-planner` target)
- **AC (with mandatory categories):**
  - [ ] Happy path: `FirstStepMatch` evaluator scores 1.0 when `react_step.action.tool` matches `expected_steps[0]` -> eval
  - [ ] Happy path: `ThoughtRelevance` evaluator scores 1.0 when thought is non-empty, longer than 10 chars, and not in boilerplate blocklist -> eval
  - [ ] Happy path: Model precheck runs before any case execution and skips entire suite with clear message on model unreachable -> eval
  - [ ] Happy path: First run creates per-model baseline `baselines/planner-{model_id}.json`, second run enforces gate -> eval
  - [ ] Happy path: Per-case progress output shows `[N/163] case-id status (elapsed)` format -> eval
  - [ ] Null/empty: Cases with `context` field pass context dict to `planner.step()`, cases without pass `None` -> eval
  - [ ] Null/empty: `ThoughtRelevance` scores 0.0 for empty string, whitespace-only, or None thought -> eval
  - [ ] Error path: Per-case timeout (60s via `asyncio.timeout`) prevents a single stuck LLM call from blocking the suite -> eval
  - [ ] Error path: LLM returning structurally invalid output (caught as Pydantic validation error after retries) is scored 0.0 for all evaluators -> eval
  - [ ] Error path: `make test-eval-planner` exits non-zero on regression below baseline - 10pp -> eval

### Task 4: Layer 2 -- ReAct loop eval (multi-LLM)

- **Scope:** Create `backend/tests/eval/test_react_quality.py` testing `react_loop()` from `backend/agents/pipeline.py` with `ReActPlannerAgent` (real LLM) and `ExecutorAgent` (fixture mock DB). Evaluates convergence, step sequence correctness, and step count efficiency.
- **Files changed:**
  - `backend/tests/eval/test_react_quality.py` (CREATE)
  - `Makefile` (MODIFY: add `test-eval-react` target)
- **AC (with mandatory categories):**
  - [ ] Happy path: `StepsMatch` evaluator scores 1.0 when successful step tools in execution order equal `expected_steps` -> eval
  - [ ] Happy path: `Convergence` evaluator scores 1.0 when `react_loop` yields a `type="done"` event (not max_steps timeout or error) -> eval
  - [ ] Happy path: `Efficiency` evaluator scores 1.0 when total event count <= len(expected_steps) + 1 -> eval
  - [ ] Happy path: Fixture mock DB returns realistic data -- `find_bangumi_by_title` returns bangumi_id, `query_bangumi_points` returns 3-5 points with valid lat/lng, `search_points_by_location` returns 3 nearby points -> eval
  - [ ] Happy path: First run creates per-model baseline `baselines/react-{model_id}.json`, second run enforces gate -> eval
  - [ ] Null/empty: Greeting/QA cases with single-step expected_steps (e.g. `["greet_user"]`) correctly evaluate done-only sequences with no executor steps -> eval
  - [ ] Null/empty: Mock DB `query_bangumi_points` returning empty list does not crash react_loop -- planner observes empty result and proceeds -> eval
  - [ ] Error path: ReAct loop hitting max_steps (8) without yielding done event scores 0.0 on Convergence evaluator -> eval
  - [ ] Error path: Two consecutive executor step failures trigger error event and loop termination per `react_loop` failure_count logic -> eval
  - [ ] Error path: Per-case timeout (60s) kills stuck multi-turn loops and scores 0.0 for all evaluators for that case -> eval

### Task 5: Makefile integration and Layer 1a in stable CI

- **Scope:** Add Make targets for all eval layers, composite targets (`test-eval-fast`, `test-eval-all`), and include `test-eval-components` in the `test` target so Layer 1a runs as part of stable CI.
- **Files changed:**
  - `Makefile` (MODIFY: add 5 new targets, update `test` target)
- **AC (with mandatory categories):**
  - [ ] Happy path: `make test-eval-components` runs `test_component_quality.py` with `-q --no-cov` and exits 0 -> unit
  - [ ] Happy path: `make test-eval-planner` runs `test_planner_quality.py` with `EVAL_MODEL` env var defaulting to `google-gla:gemini-3.1-pro-preview` and `-q -m integration --no-cov` -> eval
  - [ ] Happy path: `make test-eval-react` runs `test_react_quality.py` with `EVAL_MODEL` env var and `-q -m integration --no-cov` -> eval
  - [ ] Happy path: `make test-eval-fast` runs Layer 1a then Layer 1b sequentially -> eval
  - [ ] Happy path: `make test-eval-all` runs all four layers (1a, 1b, 2, 3) -> eval
  - [ ] Happy path: `make test` now includes `test-eval-components` alongside existing unit tests -> unit
  - [ ] Null/empty: `make test-eval-planner` without `EVAL_MODEL` set defaults to `google-gla:gemini-3.1-pro-preview` -> eval
  - [ ] Error path: `make test-eval-components` exits non-zero when Layer 1a has a regression -> unit
  - [ ] Error path: Existing `make test-eval` still runs Layer 3 only, unchanged behavior (backward compat) -> integration

## Verification Plan

1. **Layer 1a sanity:** Run `make test-eval-components` on clean checkout. Must complete in < 10 seconds, create baseline on first run, enforce gate on second run.
2. **Layer 1b sanity:** Run `make test-eval-planner` with `EVAL_MODEL=google-gla:gemini-3.1-pro-preview`. Must complete in < 5 minutes, show per-case progress, create baseline.
3. **Layer 2 sanity:** Run `make test-eval-react`. Must complete in < 20 minutes, all Convergence scores > 0.
4. **Layer 3 backward compat:** Run `make test-eval`. Must behave identically to before (same test file, same markers, same baseline file `gemini-2.5-pro.json`).
5. **Stable CI:** Run `make test`. Must include Layer 1a. Total runtime increase must not exceed 15 seconds.
6. **Composite targets:** `make test-eval-fast` runs 1a + 1b. `make test-eval-all` runs all layers.
7. **Baseline files:** Inspect generated baselines. Each must contain `model`, `case_count`, `scores` keys with correct types.
8. **Shared infrastructure:** Delete `baselines/component-deterministic.json`, run `make test-eval-components` twice. First run creates baseline (pytest.skip), second run passes.

## Dependencies

- **Existing 163-case dataset** (`plan_quality_v1.json`) -- no changes needed. All cases already have `expected_intent` and `expected_steps`.
- **pydantic_evals** -- already installed, used by existing `test_plan_quality.py`
- **pytest, pytest-asyncio** -- already installed
- **No new external dependencies** required
- **Task ordering:** Task 1 (eval_common) must complete before Tasks 2-4. Tasks 2, 3, 4 are independent of each other. Task 5 depends on Tasks 2-4 being complete.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Output validator is tightly coupled to `@agent.output_validator` decorator in `planner_agent.py` and cannot be extracted for isolated testing in Layer 1a | Medium | High | Extract validator logic into a standalone async function that the decorator calls. If extraction is too invasive, replicate the validator logic in the test (it is ~30 lines of deterministic checks on `ReActDeps.history` and `ReactStep`). |
| Layer 1b/2 baselines are unstable due to LLM non-determinism, causing flaky CI gates | Medium | Medium | Layers 1b and 2 are NOT in stable CI -- they run as separate Make targets only. 10pp tolerance absorbs normal variance. Multi-trial execution (pass@k) is deferred. |
| Layer 2 fixture mock DB diverges from real DB behavior, causing false passes | Low | Medium | Mock contract is documented (4 methods: `find_bangumi_by_title`, `query_bangumi_points`, `search_points_by_location`, `query_nearby_points`). Layer 3 with real testcontainer DB catches divergence. |
| `eval_common.py` extraction breaks existing `test_plan_quality.py` behavior | Low | High | Task 1 AC explicitly requires `make test-eval` to pass unchanged after refactor. Existing baseline file `gemini-2.5-pro.json` remains valid. |
| Layer 1a intent classifier accuracy is low, surfacing many AMBIGUOUS classifications that were hidden in the pipeline eval | Medium | Low | This is a feature, not a bug. Low Layer 1a accuracy highlights classifier gaps and drives targeted improvements to `intent_classifier.py` regex patterns. |
| New `test_planner_quality.py` filename collides with potential future planner unit tests | Low | Low | The file lives under `backend/tests/eval/` (not `unit/`), and the original spec chose this name. Rename is trivial if needed. |
