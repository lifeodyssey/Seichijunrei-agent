# packages/eval — AGENTS.md

The TS side of the eval move (W3 of `docs/specs/2026-09-01-agent-ts-rewrite-spec.md`, umbrella
#1258). Plain **Node** package — it reads files and drives HTTP calls at staging from `scripts/`,
so it must never enter a Workers bundle, and imports nothing from `workers/*` except the one
staging door named under “Talking to staging” below. Root guide: `../../AGENTS.md`.

It owns three things proven against Python's own answers: the **file contract** between the Python
exporter and `logfire/evals`, the **eight evaluators** (`src/evaluators/`) scoring identically to
their originals, and the **`gate.py` statistics port** (`src/gate/`) reaching bit-identical
intervals. The two halves of the W3-5 double run sit on top: the **staging task**
(`src/staging-turn-task.ts`), which turns one case into real turns, and the **gate runner**
(`src/gate-run/`, `pnpm run eval:gate`), which turns a finished run into a verdict and a committed
result file. Neither has met a live staging turn yet.

## Commands (from `packages/eval/`)

- `pnpm run test` — `node --test` over `test/*.test.ts` (Node's native TS type stripping; no
  bundler), then `test:fixture-drift`: it re-runs the Python exporter
  (`scripts/export-fixtures.sh`) and fails when the committed fixtures are not what it writes
  today (`scripts/local-gates/eval-fixture-drift.sh`). That arm needs `uv` — comparing without
  re-exporting would always be clean, which is no gate at all.
- `pnpm run lint` / `pnpm run lint:oxlint` — type-aware oxlint, warnings denied.
- `pnpm run typecheck` — TypeScript 7.0.2 `tsc --noEmit`.
- From the repo root: `pnpm run test:eval`. Both run in the `eval` CI lane and in the pre-push
  `gate_eval`.

## The round trip (what is measured, not assumed)

`apps/agent` writes each dataset with pydantic-evals' `Dataset.to_file`; this package reads it with
`logfire/evals` `Dataset.fromFile`. Regenerate both artifacts with
`bash packages/eval/scripts/export-fixtures.sh`; `scripts/local-gates/eval-fixture-drift.sh` fails when the
committed fixtures are not what the exporter writes today.

Per set, `fixtures/` carries two files:

| File | Written by | Role |
|---|---|---|
| `<set>.json` | `Dataset.to_file(path, schema_path=None)` | the round-trip subject — what `Dataset.fromFile` reads |
| `<set>.cases.json` | `--export-cases` → `dataset_case_view.py` | the independent expectation, built from the Python dataclasses rather than pydantic-evals' serializer |

`fixtures/evaluator-oracle.json` is written by the same script, from
`apps/agent/src/animichi/tests/eval/evaluator_oracle.py`, and is the drift-guarded oracle for the
evaluators (below) rather than for the round trip.

Two files because one is not enough: comparing the loaded dataset against the file it was loaded
from compares that file with itself, and a mutated fixture would move both sides together.

**Measured with pydantic-evals 2.21.0 ↔ logfire 0.22.5** (751 cases across the six sets):

- Reading is lossless. `inputs`, `metadata`, `expected_output` and the evaluator specs deep-equal
  the Python objects; the wire keys are snake_case on both sides (`expected_output`), and only the
  TS in-memory accessor is camelCase (`case.expectedOutput`).
- Parameterless evaluators serialize as bare strings; both sides read them back as
  `{ name, arguments: null }` (`Evaluator.as_spec()` ↔ `Evaluator.getSpec()`).
- `expected_output: null` reads back as `null`, not `undefined`.
- JSON and YAML both load; we commit JSON because that is the canonical datasets' own format and
  it diffs readably.
- **Writing is not symmetric** — `Dataset.toObject()` re-emits a different key order, drops
  `report_evaluators` when empty and drops a case's `evaluators` when empty. W3 only reads, so this
  does not block "zero migration"; do not build a TS-side re-export on the assumption of byte parity.
- An unregistered evaluator name throws `Unknown evaluator name: "<name>" (registered: …)` — loud,
  named, never a silent drop. `src/evaluator-names.ts` is the single list; W3-3 implements against it.
- Registry key: a class's `static evaluatorName` **or** its runtime `name`. `evaluationName` is a
  per-instance result-name override, not the registry key.

## The eight evaluators (`src/evaluators/`)

One module per evaluator, named for its class; `src/evaluators/index.ts` is the registry list
`Dataset.fromFile` resolves the exported names against. Four are ports of pydantic-evals' official
agentic evaluators — which read an OTel span tree the TS side does not have — and four are the
project's own, ported from `evaluators.py`.

- **`transcript-view.ts` is the seam, and it is W3-2's type.** The evaluators read `TranscriptResult`
  from W3-2's `turn-transcript` module (#1300) and nothing else. Until that branch lands, the file carries a
  field-for-field copy with the one-edit replacement written at the top.
- **There is no span tree, and no need for one.** `trajectory` is what the SD-9 stream publishes and
  `stepCount` is `len(AgentResult.steps)` for every turn the wire can describe. It is NOT the span
  tree: a deterministic selection publishes a tool part named for its stage
  (`turn-frames.ts::serverStepOpened`) and produces no span at all, and the frames carry no member
  that tells a server-initiated call from a model-initiated one. Measured on staging 2026-09-07
  (#1454) — see the ANY-of-N entry below, which is where the difference is paid for. `status` has
  three states:
  `"unsettled"` (made, never settled) is excluded wherever `include_failed=False` applies and counted
  by `MaxToolCalls`, which counts every attempt.
- **ANY-of-N lives in `accepted-chains.ts`, and the stage decides it alone.** A case names
  acceptable *stages*, each contributing chains; the tool and trajectory evaluators score once per
  chain and keep the best. `plan_selected` and `plan_multi` accept the empty chain because those
  stages bypass the model — not because the inputs carry a selection. An input-level
  short-circuit used to say the second thing. Counted over the six exported sets, **twenty** cases
  carry a selection (fifteen `plan_selected`, four `plan_multi`, one `search_nearby`) — count on
  `!== null`, not on truthiness, because three of the fifteen select an empty list and the
  short-circuit fired on them too. It was a no-op on nineteen of the twenty and wrong on the
  place selection, whose stage is `search_nearby`: it accepted the empty chain, so a turn that
  called nothing scored 1.0 and the turn that made the call scored 0.0 (#1439).
  `bestOverChains` returns 1.0 for a case with no accepted chain — `_best(..., empty=1.0)`.
  **A bypass stage is TWO chains, because the table answers to two trajectory sources (#1454).**
  In process the bypass makes no model call and no span, so Python observes the empty chain; over
  the wire the same turn publishes one tool part named for the stage, so this runner observes that
  one. `plan_multi` therefore lists both. Measured on staging 2026-09-07 with all four seeded
  `plan_multi` cases: every turn published `plan_multi` and nothing else, and under the empty chain
  alone the two turns that FAILED scored 1.0 (a failed call is excluded from the trajectory) while
  the two that did the work scored 0.0 — on `trajectory_match`, `tool_correctness` and
  `max_tool_calls` alike. The empty chain stays listed for port parity, and that has a price: an
  *unseeded* `plan_multi` turn publishes no step at all and still scores `trajectory_match` 1.0
  (measured the same day, 1.0 on all four) — #1303 reads these numbers and must not take that 1.0
  for something the agent did. `plan_selected` lists both rows for the same reason and on the same
  measurement (#1461): `K1_ja_001` and `K1_en_002` each published `plan_selected:ok` and nothing
  else, and each scored `trajectory_match`, `tool_correctness` and `max_tool_calls` 0.0 against the
  empty chain alone. That row reaches fifteen of the 662 baseline cases, so #1303's comparison is
  misread on them before this lands and comparable after it — and it carries the same price on all
  fifteen: the empty chain stays listed for port parity, so a `plan_selected` turn that publishes no
  step at all still scores `trajectory_match` 1.0. That one follows from the row rather than from a
  measurement — both turns measured here DID publish the step — and #1303 must not read it as
  something the agent did either.
- **`{}` is not `0`.** `NonemptyResults` on an untagged case, `ArgumentCorrectness` on a turn with
  no successful call, and `StepEfficiency` on a turn that took no step when the case's every
  acceptable ideal is at least one (#1439) all emit *no metric*. That last one is a ratio with no
  denominator: when a zero-step ideal is acceptable (`greet_user`, `general_qa`) taking no step IS
  ideal and scores 1.0, but otherwise the turn did not attempt the task and this metric — which
  measures waste, not correctness — has nothing to say. `test/evaluator-parity.test.ts` compares the
  whole score record, so a surplus zero fails there.
  **This costs a real measurement, and the cost is known.** The nineteen bypass cases (fifteen
  `plan_selected`, four `plan_multi`) are expected to make no model call — the empty chain is one of
  the two their stage accepts — yet `_STAGE_MIN_STEPS` still gives them an ideal of 1 or more. A turn
  that correctly bypasses the model and records no step therefore has an ideal ≥1 and an actual of
  0, and now yields `{}` where it used to yield a 1.0 that was, for those cases, the right answer
  for the wrong reason. The narrower rule — an ideal of 0 for any stage whose only chain is empty —
  would keep it, but it rests on a pre-existing mismatch (the ideal counts deterministic steps that
  the stage's own chain vocabulary excludes), so it is filed separately rather than widened into
  #1439. #1454 and #1461 answered the chain half of that question — neither bypass stage's chain is
  only the empty one any more — without moving `_STAGE_MIN_STEPS`.
- **`_available_data_keys` is ported once, in W3-2.** `DataKeysPresent` reads `dataKeys`; it does not
  re-derive the rule. The oracle publishes Python's own `_available_data_keys` under that name, so it
  is the tripwire for `dataKeysOf` too.
- **The oracle, not a re-derivation.** `fixtures/evaluator-oracle.json` is what the *Python*
  evaluators score for 26 synthetic transcripts — every `_acceptable_min_steps` branch, the ANY-of-N
  ties, the two empty-chain selection stages, the bypass step as the wire publishes it — one
  scenario per bypass stage (#1454, #1461) — and the place selection that is not one, the zero-step turn on a case that required a step, the three call outcomes, the `resolve_reply_language`
  decision points, and both answers `argument_correctness` can give (a call settled into a coerced
  value and one settled with an optional null dropped, each scored 0.0 by Python itself) — paired
  with the wire transcript the TS side reads for the same turn. Changing an
  evaluator on either side means re-running `export-fixtures.sh` and re-proving the numbers in the
  same change; the drift gate is what forces it.
- `EVALUATOR_VERSION = 'official-v2'` mirrors `evaluators.py` and rides on every instance as
  `evaluatorVersion`. Bump both sides together or the two runners' baselines stop being comparable.

### The two witnesses `argument_correctness` scores (#1381)

Python compares the span's raw arguments against `StepRecord.params`, the *separately* recorded
arguments the runner settled for the same call. The stream publishes only the first, so the metric
was degenerate here until the retrieval published the second: `GET /v1/conversations/{id}/messages`
carries every settled step of every run of the session (`steps`, additive), each with the params
its tool executed with as JSON text, and `turn-transcript.ts` pairs them onto the frames' calls by
**tool name and occurrence** — the pairing `ArgumentCorrectness(tool, occurrence=k)` makes itself,
and the only one that survives a settled step the stream never published (`respond`).

The metric therefore has THREE answers, and `src/settled-params.ts` owns the distinction. A read
that published no `steps` array at all (an edge older than #1381, the Python route's `null`, a read
that never answered) offered no second record for any call: `TranscriptResult.paramsRecorded` is
false and the evaluator emits NOTHING, the same `{}` a turn with no successful call emits. Within a
read that DID publish steps, a call with no step of its own is `params: null` and scores 0 — the one
answer this side gives that Python has no case for, since Python always had a `params` dict and an
unrecorded one could pass vacuously (`params_recorded`, #443). A call nobody witnessed must not be
able to score 1.0, and "unmeasured" must not look like "every call was wrong".

### One place the wire still cannot reach Python, and what it costs

- **`nonempty_results` substitutes the published `results` for the itinerary's `source_ref` hop.** The
  stream carries row counts and points, never a ref to follow, so a routed turn is judged by the
  search it published. Python's two failure branches (no `source_ref`; a `source_ref` that misses the
  registry) both land on the same observable: no `results` in `data`.

### The ninth metric, which is report-only on purpose (E-3 #1382)

`reply_claim_traceability` is the one measurement here with no Python twin: a **deterministic**
final-reply verifier (spec §十 10.3, 李博杰 ch.7 「做对了但说错了」). The eight ported evaluators read
the trajectory and the `data` keys; none of them asserts anything about the sentence a visitor
reads, which is where a third of τ²-bench's information-reporting failures live.

- **Not an evaluator, and not registered.** The registry resolves the names the exported dataset
  FILE carries, and every registered evaluator is scored against Python's oracle. This one is a
  function (`src/evaluators/reply-claim-verifier.ts`) that `src/gate-run/report-only-metrics.ts`
  calls over the finished report, so it lands in `GateRunResult.report_only` and can reach neither
  `metricNames()` (positionally aligned with the baseline) nor `caseScoresFromReport` (what the
  bootstrap gate compares). Owner decides after a full baseline cycle whether it graduates (#1303).
- **Its coverage is bounded before anything is judged.** `reply-claims.ts` extracts exactly two
  forms — a quoted span (a NAME claim) and a digit run carrying a counting word (a COUNT claim).
  Everything else is unmeasured, `{}`, which is neither a pass nor a failure. A reply with no
  decidable claim must not score 1.0; that vacuous pass is one of the two mistakes the spec names.
- **The other one is a false positive, and the defence is a COMPLETE source list.**
  `reply-claim-sources.ts` enumerates five: this run's calls, this reply's own `data` rows (a place
  name exists *only* here — rows never travel through a tool's `details`), the user's own words,
  the **earlier runs' calls** (§九 9.1 / #1377 — counting only "this run" contradicts §九
  directly), and the `<agent_status>` bar (§九 9.3), whose lines that module maps one by one onto
  the sources that cover them. A "call" is both ends of it: the return AND the arguments, because
  #1377 replays every assistant tool-call message verbatim and the bar's retention line quotes
  `run_steps.input` back at the model (`workers/edge/src/agent/memory/rescued-entity.ts`). The one bar line no other
  source reaches is a SEEDED case's open question, witnessed by `inputs.seeded_pending`. Names are
  compared by EQUALITY after NFKC folding, so a sequel cannot pass as its original; counts are
  compared as numbers, so `２件` equals a `row_count` of 2.
- **The leniency this buys, stated up front:** a name that appears only in a tool ARGUMENT is
  traceable without being corroborated, since it is the model's own words replayed back to it. That
  is the false-positive-avoiding direction; catching an invented title needs the OUTCOME read too,
  which is `tool_correctness`' and `nonempty_results`' job.
- **Place names are judged only when the reply published rows.** A prose-only answer's `data` is
  `{}` (`turn-answer-part.ts`), so there is nothing to compare against and the claim is unmeasured
  rather than wrong.
- **`TranscriptStep.output` and `TranscriptResult.priorTrajectory` exist for this.** The first is
  `tool-output-available.output` — the outcome `details`, kept per step instead of discarded. The
  second is the earlier submissions' calls (`prior-turn-returns.ts`): `StagingTurnTask` used to
  drop every response but the last, and since #1377 those turns' returns are in the model's context.
  Neither is folded into `trajectory` or `stepCount`, which stay the measured turn's.

`src/metric-names.ts` ports `eval_harness.metric_names` — same names, same order, checked against the
oracle's committed dump. Order is load-bearing: baselines and report tables are keyed positionally.
Three columns are conditional: `nonempty_results` on the DATASET (no tagged case, no column), and
two on the RUN (`src/gate-run/run-metric-names.ts`) — `argument_correctness` when no case was
offered the settled params, and `step_efficiency` when no case scored it at all, which an unseeded
`phase1c_selection_v1` arm reaches exactly (every turn refuses, so no turn has a denominator). All
three exist because `aggregateScores` is strict, as Python's `_scores` is: a metric the list names
and the run does not report throws, which would let one unavailable measurement take the other
seven down with it.

## Version pin

`PINS.json` declares pydantic-evals and logfire compatible **as a pair** — one writes the file the
other reads. `test/pins.test.ts` compares it against `packages/eval/package.json` (logfire, exact,
never a range) and `apps/agent/uv.lock` (pydantic-evals, resolved through the `pydantic-ai` extra;
it is not declared in `pyproject.toml`). Moving either version means re-exporting the fixtures and
re-proving the round trip in the same change.

## Conventions

- No `any`; `inputs.context` / `inputs.seeded_pending` stay open maps because the Python source
  declares them as `Mapping[str, object] | None` — mirroring it is the point.
- Fixtures are generated. Never hand-edit one; change the canonical dataset in
  `apps/agent/src/animichi/tests/eval/datasets/` (or, for the oracle, its scenarios in
  `apps/agent/src/animichi/tests/eval/evaluator_oracle_scenarios.py`) and re-export.
- Nothing under `src/evaluators/` may derive an expected score. Python decides the numbers; the
  tests only compare.

## The statistical gate (`src/gate/`, W3-4)

`gate.py` + `stats.py` ported for Node. The port is **numerically identical**, not
merely equivalent: `packages/eval/fixtures/stats-oracle.json` is written by
`apps/agent/src/animichi/tests/eval/stats_oracle.py` running the Python
originals, and every module here is asserted against it. Regenerate it with the
rest of the fixtures — `bash packages/eval/scripts/export-fixtures.sh` writes it
last, so
`scripts/local-gates/eval-fixture-drift.sh` fails when `stats.py` or `gate.py`
moved and this file did not.

Three CPython behaviours had to come along for the numbers to agree, each one
found by a red test rather than by reading:

| Module | Reproduces | Why a JS built-in is not enough |
|---|---|---|
| `python-random.ts` | `random.Random` (MT19937, `getrandbits`, `choice`) | any other generator gives a different, equally "correct" interval |
| `python-sum.ts` | `math.fsum` **and** `sum()` | `sum()` is **interpreter-sensitive**: 3.12 gave it Neumaier's correction, so the port matches the 3.11 the agent ships on (see below) |
| `python-number-text.ts` | `.4f`, `.0%`, `repr` | Python rounds a decimal tie to even and writes `1.0`; `toFixed`/`String` do neither |

Notes for the rest of W3:

- **The oracle is pinned to Python 3.11**, the interpreter `apps/agent` ships on
  (`python:3.11.13-slim`) and CI installs (`uv python install 3.11`). `sum()`
  gained Neumaier compensation in CPython 3.12, and `stats.py` means every
  bootstrap sample with it, so a 3.12+ run writes different numbers: measured,
  `graded` moves from `0.4749999999999999` to `0.475`. `stats_oracle.py` refuses
  to write on any other version and `export-fixtures.sh` pins the interpreter.
  Moving the agent off 3.11 turns this gate red on purpose — `pythonSum` is what
  has to change with it.
- **Warnings are returned, not logged.** Python's non-blocking half (INDETERMINATE,
  skipped metrics, stale baselines) goes to `logging`; here every gate returns
  `{ failures, warnings }` with the same strings. One of the five is not
  text-identical and cannot be: Python interpolates the pydantic `ValidationError`
  into `Invalid baseline for …`, and there is no such object on this side, so the
  message names the schema instead. The other four are pinned verbatim.
- **A damaged baseline is a failure here, and that is the one place this side does
  not mirror `gate.py` (#1341).** Python logs `Invalid baseline for …` and carries
  on, so a truncated or hand-edited committed record disables the regression gate
  with a non-blocking line that reads exactly like a legitimate first run. On this
  side `readBaselineRecord` returns that line under `failures` (missing and stale
  stay under `warnings`), `gateRunResultOf` folds `baselineFailures` into
  `GateRunResult.failures`, and `eval:gate` exits 1. Nobody re-runs their way out
  of a damaged file, so it must not look like an ungated run. Whether `gate.py`
  should stop warning and follow this side is #1351; until it does, the two
  runners disagree on this one answer by design, not by drift.
- **`baselines/` holds Python-written records.** `baselineRecordText` reproduces
  `model_dump_json(indent=2)` byte for byte, so a record written by either side is
  a no-op diff for the other; the committed
  `agent_l4_trajectory_openai-mimo-v2.5-…json` (662 cases) is the record W3-5
  compares against.
- **Strata come from the canonical dataset, not the exported fixture** (a W3-1
  finding, measured on `fixtures/agent_eval_v3.json`): `Dataset.to_file` keeps only
  `AgentExpected`, so a row's `path` does not survive the export. `case-strata.ts`
  reads `apps/agent/…/datasets/<set>.json`, exactly as `load_case_strata` does. A
  gate driven off the exported fixture alone would silently degrade to
  `unstratified`.
- **Assertions are folded into the case scores as 1/0.** Python's evaluators all
  return floats; a TS evaluator that returns a boolean lands in
  `report.assertions`, and dropping it would remove a metric the baseline expects.

## Talking to staging (W3-2 #1300)

`src/` shapes and decides; `scripts/` is the only place a credential is read or a request is
made. That split is why the task can be tested with a fake fetch at all.

| Piece | Owns |
|---|---|
| `src/turn-transcript.ts` | (SSE frames, transcript read) → `TranscriptResult`, the members Python's evaluators read off an `AgentResult`, plus each step's published return (#1382) |
| `src/prior-turn-returns.ts` | the earlier submissions' calls, which #1377 puts back in the model's context |
| `src/settled-params.ts` | the one part of the shaper that reads the RETRIEVAL surface: whether a second record was offered at all, and which settled step answers which frame call |
| `src/case-submissions.ts` | the `POST /v1/chat` bodies one case sends, history first |
| `src/staging-turn-task.ts` | the `Dataset.evaluate` task: submit, retry policy, concurrency bound, read back |
| `src/prefix-seeding-lifecycle.ts` · `src/trajectory-prefix-case.ts` · `src/seeded-sessions.ts` | the `CaseLifecycle` that seeds a case's frozen prefix before its turn (E-1 #1380) |
| `src/staging-bearer.ts` · `src/neon-auth-bearer.ts` | the 15-minute Neon Auth JWT, minted and re-minted on age |
| `scripts/eval-staging.ts` | `pnpm run eval:staging -- --dataset <set> --limit <n>`; prints `renderReport` |
| `scripts/record-captures.sh` | re-record `fixtures/captures/` from live turns, once a gate token exists |

**One door.** Every staging request goes through `workers/edge/api-test/lane-origin.ts`
(`laneFetch`), which is why `edge-worker` is a devDependency here. It is the single module
that resolves `CATALOG_API_ORIGIN`, refuses a non-loopback origin that is not HTTPS, attaches
`x-staging-key`, and forbids following a redirect (#1291, #1294). Reimplementing those four
rules would be three places for one of them to be forgotten, and the request that forgot is the
one that carries a bearer to wherever a `Location` header pointed. Neon Auth is a **different**
origin behind no WAF rule, so `neon-auth-bearer.ts` takes an injected sender and never reads the
door's environment. `test/staging-door.test.ts` holds all of that.

**Cases that need a starting point (E-1 #1380).** Five cases — all of `phase1c_selection_v1` —
carry `inputs.seeded_pending`, a clarification their measured turn REPLIES to. Python set that
state directly on an in-process session (`eval_harness._selection_task`); over HTTP a session's
state is the trace of its turns, so `CaseLifecycle.setup()` posts a frozen prefix to the edge's
staging-only seeding procedure before the task runs, and the task then sends the case's turns to
that session (`SeededSessions`, keyed on the case's own `inputs` object — the one reference the
driver hands both the lifecycle and the task). **No new dataset format**: `seeded_pending` was
already exported and no fixture was re-exported. What that field CANNOT carry is the turn that
left the state — it names a reason, an ordered candidate list and a revision, and nothing about
the ask — so `trajectory-prefix-case.ts` derives the minimal turn consistent with it: the tool
that can raise that clarification (`resolve_anime` / `search_nearby`), called with the first
offered title standing in for the user's own words, answered with the offer the question makes.
Every byte is a function of `seeded_pending`, so two runs derive the same prefix. A refused
seeding **fails the case** rather than running it unseeded: an unseeded selection case measures a
`SELECTION_EXPIRED` refusal and scores it as the agent's answer. Seeded cases keep their ids and
are marked on the report with the `prefix_seeded` attribute (`setEvalAttribute`, set from the
task, because the driver opens the task-run context around the task and not around `setup()`).

**`locale` is the requested locale, not a derived one.** The answer envelope publishes none to
derive from — `session` is `{}` and `ui` is a component name, both constant by contract
(`turn-answer-part.ts::capturedMembers`). Python did not derive one either: `LocaleMatch` reads
`ctx.inputs.locale` together with the answer's prose. So the result carries the locale that was
asked for and the message that came back, and W3-3 scores the pair.

**Fixtures.** The shaper is measured against the Python-recorded SD-9 captures in
`apps/agent/tests/fixtures/chat_stream/`, read in place rather than copied, each with the
`<name>.agent-result.json` its recorder writes from the same turn using the evaluators' own
accessors. Their **frame grammar** is the deployed edge's — #1283 built `turn-frames.ts` off
these files and matched them frame for frame — but their answer **envelope** predates a change
in `agent_result_to_response`, which now projects the payload from the session registry (see
`record_fixtures.py`'s own note). So `dataKeysOf` is pinned against both shapes: the recorded
one, and today's `{results, itinerary}` pairing. `fixtures/captures/*.messages.json` is the one hand-written fixture here — Python
never served `GET /v1/conversations/{id}/messages` for those turns — and it is parsed through
the contract's `GetSessionHistoryResponse` so it cannot drift into a shape the edge would never
send. Its `steps` restate each call's arguments as the settled params, because that is what the
recorder had: `record_fixtures.py` declares ONE `params` per replayed call and writes it as the
frame's `args`, so a capture cannot witness a divergence — the oracle's two settled-params
scenarios are where that branch is measured. **Unverified:** no capture has been taken from a live staging turn yet; there was no
`STAGING_GATE_TOKEN` in reach when this landed. `scripts/record-captures.sh` is how that
changes, and the shaper needing an edit afterwards is itself the finding.

**Why `lib` includes `DOM`.** `tsconfig.json` compiles the shared door, which is written against
`HeadersInit`; `@types/node` publishes `fetch`/`Response`/`Headers` globally but not that name.
The package is still Node-only — nothing here may touch a browser global, and the tests would
say so immediately if it did.

## Gating a run (`src/gate-run/`, `scripts/eval-gate.ts`, #1327)

`pnpm run eval:gate -- --dataset <set> --limit <n> --concurrency <n>` is
`eval:staging` with a verdict: the same `StagingTurnTask` run, then W3-4's two
gates on the paired scores, a result file, and `run_agent_eval.py`'s exit code.
Two entries rather than one flagged entry, because "look at a run" and "block on
a run" want different defaults and different blast radii — `eval:gate` defaults
to `agent_eval_v3`, which is 662 real staging turns on the QA identity.

- **Results land in `results/<date>-<dataset>.json`, committed.** #1303's
  acceptance criterion is a report *committed* under results, so nothing here is
  gitignored: a verdict that only ever existed on the runner's laptop cannot be
  the evidence for a wave exit. Same date, same set, same filename — a re-run
  overwrites rather than accumulating near-identical files.
- **The baseline is pinned in `python-baseline.ts`, and never written.** Layer
  `agent_l4_trajectory` and model `openai:mimo-v2.5@https://api.xiaomimimo.com/v1`
  are constants, not flags: a gate whose baseline can be pointed elsewhere on the
  command line can always be made to pass by pointing it somewhere easier.
  Python's uncapped run *creates* a record when it finds none
  (`_run_uncapped_gate`); this runner never does, because the run being judged
  must not be able to write what judges it.
  **The 2026-09-07 refresh (#1303) moved two variables at once** — the evaluator
  vocabulary to `official-v2` and the endpoint off `https://opencode.ai/zen/go/v1`,
  which began refusing every request without an `x-opencode-session` header — so
  the Python-versus-Python deltas across that record are not attributable to
  either change alone.
- **A limited run cannot be gated, and says so.** `readBaselineRecord` is given
  the run's own case count, so `--limit 3` makes the 662-case record stale, the
  gate compares nothing, and the warning explains — the same place Python's
  capped runs land (`CAPPED` skips the baseline entirely).
- **`metricGateResults` is why the file can name a verdict.** `bootstrapGate`
  returns only strings; the result file needs the interval and the verdict per
  metric. Rather than a second comparison off the same pairs — a second seed, a
  second interval, eventually a second answer — `bootstrap-gate.ts` exposes the
  per-metric rows and `bootstrapGate` became the fold of them. `skipped` is the
  fourth answer a metric can get: fewer than ten paired cases, no comparison.
- **Only a `fail` exits 1.** `gate_exit_code` exactly: `indeterminate` and
  `skipped` are warnings and exit 0, because a gate that blocked on "not enough
  evidence" would block on noise. A damaged baseline is the one addition to
  Python's failure list (see the statistical-gate section above): it arrives as
  `baselineFailures` and exits 1 like any regression. A run where every case
  errored throws `All cases errored` out of `aggregateScores` and writes no
  file — Python's `NoEvaluatedCases`, which also persists nothing.
- **The breakdown groups by answered intent and requested locale.** There is no
  `metadata.intent` to read and no per-intent summary in `eval_harness.py`;
  what Python has is `exec_tiers.CaseRow`, which writes `intent` off the
  `AgentResult` and `locale` off the inputs onto every row. `score-breakdown.ts`
  groups by exactly those two, and each group's numbers come from
  `logfire/evals`' own `computeAverages` — so a metric only some cases carry
  (`nonempty_results`) averages over the cases that have it, with the `count`
  beside the mean. Errored cases are not in it: no output, no intent, no scores;
  they are the error-rate gate's business.
- **There are no token or dollar counters, and that is a measurement.** Python
  reads usage off `AgentResult.usage`; the SD-9 stream publishes no usage part
  and the history read carries a run status and nothing about cost. `spend`
  therefore records what the wire can witness: `turns_planned`, the
  `POST /v1/chat` submissions the cases call for (`caseSubmissionsOf` is pure,
  so history replays are counted exactly), and `task_seconds`. A double run's
  dollar figure comes from the provider dashboard.
- **Not ported: the direct thrash gate.** `direct_gates.py` counts requests and
  repeats per case out of `AgentResult`; neither number crosses the wire. It is
  report-only in Python too (`DIRECT_GATE_ENFORCE`), so nothing that blocked
  there stopped blocking here.

### Where a failed case first went wrong (E-4 #1383)

`GateRunResult.failure_attribution` answers the question an end-to-end score cannot: not "did this
case fail" but "from which step". Spec §十 10.4, 李博杰 ch.7 「失败归因：从整条轨迹定位首个错误」.
Report-only by the **same mechanism** as `report_only` — computed over the finished report in
`gate-run/`, outside `scores`, outside `metricNames()`, outside `caseScoresFromReport`, and read by
no gate. It gets a field of its own only because `report_only` is typed as metric columns.

- **A failed case is the run's own verdict, not a new threshold.** An errored case
  (`report.failures`) has no turn to read and is only counted — the error-rate gate's business, as
  in `score-breakdown.ts`. An evaluated case failed when one of the scores `caseScoresFromReport`
  already keeps for it, plus the report-only `reply_claim_traceability`, is below 1 — the value
  every evaluator here emits for "nothing was violated". On the committed 657-case baseline that is
  312 failed against 345 perfect.
- **Four rules, no LLM, earliest wins** (`first-deviation.ts`): the first positional divergence
  from the case's accepted chains (`chain-divergence.ts`, asking `accepted-chains.ts` rather than
  re-deriving it), every step settled `status === "error"`, every completed call whose two witnesses
  disagree (`argument_correctness`' own predicate), and every claim E-3's verifier could not trace
  (`unsourced-claims.ts`). The spec §十 10.4 lists three; the fourth is there because
  `argument_correctness` is a live column whose failure HAS a step index — without it the oracle's
  `settled_params_dropped_an_optional_null` came back unattributed. Order is
  `(step_index ?? trajectory.length, category tie-break, claim_index)`, so a reply claim is later
  than every step, a missing call sits at `trajectory.length` and beats a claim on the tie, and at
  one step a chain divergence beats wrong arguments, which beat a tool error.
- **`"unsettled"` is not a signal, and it suspends the chain comparison.** A call that was made and
  never settled makes the completed-call sequence a partial record of the turn, so the positional
  comparison is skipped rather than reporting `missing_call` about a call that WAS made — the
  oracle's `unsettled_call_excluded_from_chain` is unattributed here on purpose. Blaming the harness'
  own observation gap on the model is the AndroidWorld mistake §十 10.4 footnotes.
- **A closed six-member vocabulary**, the book's table cut to what these rules can witness:
  `wrong_tool`, `missing_call`, `extra_call`, `wrong_arguments`, `tool_error`, `reply_unsourced`.
  `deviationCategory` is the one door a category becomes a record through and throws on anything
  else.
- **A failed case the rules cannot place gets no record** and is named under `unattributed`. A
  locale slip has no position in a trajectory, and inventing step 0 for it would be a fabricated
  root cause.
- **A tool name is model text, so the committed record whitelists it.** `turn-transcript.ts` takes
  `toolName` verbatim off a `tool-input-start` frame, so a hallucinated or injection-induced name
  would otherwise reach `results/`. `declared-tool-name.ts` projects anything the contract does not
  declare to `<unknown-tool>`; the list is a `Record` keyed on `CatalogToolName | WebToolName`, so
  the compiler goes red the day a seventh tool is declared. `expected_tool` is not masked — it comes
  from `accepted-chains.ts`' own constants.
- **Raw evidence never enters git.** The committed record carries ids, indices, declared tool names
  and numbers plus an `evidence_artifact` reference; the query, the reply and the tool returns go to
  `artifacts/attribution/<date>-<dataset>.jsonl`, gitignored. **No CI lane runs `eval:gate` today** —
  `agent-eval-nightly.yml` runs the Python suite through `.github/actions/agent-eval`, and the TS
  gate is a hand-run from a worktree until W3-5 (#1303) gives it one; `attribution-evidence.ts`
  states what the upload step must do when it exists. `results/` is committable because
  「Nothing here is a secret」; `run_steps` is not granted even to `readonly` because it carries the
  visitor's query text, and a failed `injection_g1_v1` case carries the injection itself. One
  analysis, two projections, and `test/gate-run-attribution-evidence.test.ts` proves the drop with a
  marker string.
- **`unsourced-claims.ts` restates E-3's two verdict lines** because the verifier folds them with
  `Math.min` and keeps them private. `test/gate-run-unsourced-claims.test.ts` pins the restatement
  to the original — the minimum of these verdicts is the metric the verifier reports, and no decided
  claim is its `{}`.
