# Eval SDK evidence — Pi 0.85.1 and Logfire 0.22.5

Recorded 2026-09-09 for [#1533](https://github.com/lifeodyssey/animichi/pull/1533) and
[E1](https://github.com/lifeodyssey/animichi/issues/1557), [E2](https://github.com/lifeodyssey/animichi/issues/1558),
[E3](https://github.com/lifeodyssey/animichi/issues/1559), [E4](https://github.com/lifeodyssey/animichi/issues/1560).
This is research evidence, not another architecture target. The
[canonical harness spec](../../specs/2026-09-09-agent-on-pi-harness-spec.md) owns the target and acceptance criteria.
The current instruction permits internal replacement and deletion of adapters; historical product data,
external contracts and observable domain behavior remain protected.

## Exact sources and scope

- Pi **0.85.1**, published commit `d981de1229ef899957bbe968bc8dcda02a21f477`: [public API][pi-api],
  [session implementation][pi-memory], [fork implementation][pi-fork], [upstream harness document][pi-doc].
- Logfire **0.22.5**, the [eval package's locked dependency](../../../packages/eval/package.json):
  official `logfire@0.22.5` tag resolves to `3ed526d861e530d9b8d86c562a5fb8e69e4534a9`;
  [Dataset][lf-dataset], [evaluator options][lf-types], [reporting][lf-report], [ReportEvaluator][lf-analysis].
- Both experiments below ran locally without a model call, tool network request, agent database or deployment.
  They establish SDK behavior, not completion of the production rewrite or a passing live eval suite.

## Executed probe 1: native session fork

An isolated installation pinned pi-agent-core, pi-ai, chord and pi-telemetry to **0.85.1**, with install scripts disabled.
The probe imported only the public package root. It created a MemorySessionRepo session and branch, appended
one custom entry, wrote a scalar referring to that entry, appended one list element, and called native tree fork.

| Observation | Actual result |
|---|---|
| `repo.fork(source.metadata, {scope: 'tree'}, context)` | Succeeded |
| Application scalar payload | Preserved |
| Full entry content and original entry ID | Preserved |
| `fork.getEntry(originalRef, context)` | Resolved the same entry |
| Source application list | 1 element |
| Forked application list | **0 elements** |
| Another MemorySessionRepo forks the source metadata | Throws `Unknown session` |

Exit code: **0**, with assertions covering every result above. The list methods exist; fork omits their contents.
The source explains the behavior: fork snapshots contain entries and scalar values, and destination writes
contain only entry/value writes. Memory fork resolves source IDs in its own repository map. There is no public
MemorySessionRepo import/hydrate operation. [Memory implementation][pi-memory], [fork implementation][pi-fork].

The pinned upstream document marks WP08 list support unfinished even though its later normative text describes
list copying. Implemented behavior takes precedence over that promise. Native `ForkOptions` also permits
`entryId`/`position` only for **branch** fork; tree fork copies the source's current tree. [Fork options][pi-session].

Committed evidence: [public-root probe](sdk-native-evidence/pi-fork-probe.mjs),
[original JSON output](sdk-native-evidence/pi-fork-output.json),
[exact-version reproduction commands](sdk-native-evidence/README.md#reproduce-the-probes), and
[portable-script exit record](sdk-native-evidence/verification.json). These supplement the public source and result table.

## Executed probe 2: Logfire native ESM evaluation

The probe used installed **logfire 0.22.5** through its ESM export, matching this package's module mode.
It constructed native Case, Dataset, Evaluator and ReportEvaluator instances and evaluated with `repeat: 2`.

| Observation | Actual result |
|---|---|
| Successful task repeated twice | Two runs in one `caseGroups` group |
| Evaluator returns `false` | Named failed correctness assertion |
| Evaluator returns `{}` | No assertion emitted |
| MaxDuration alongside correctness | Separate assertion; does not replace correctness |
| ReportEvaluator returns a scalar analysis | Present in native `report.analyses` |
| Task throws, `retryTask: {retries: 0}` | Two invocations, two native group failures |
| `setEvalAttribute` inside task | Captured on both runs without an internal ALS workaround |
| `renderReport(report)` | String |
| `report.toFile` | Undefined; report is data, not a persistence object |

Exit code: **0**. Source: [Dataset execution][lf-dataset], [report grouping][lf-report], [report analyses][lf-analysis].
Committed evidence: [native ESM probe](sdk-native-evidence/logfire-probe.mjs),
[original JSON output with local paths redacted](sdk-native-evidence/logfire-output.json),
[exact-version reproduction commands](sdk-native-evidence/README.md#reproduce-the-probes), and
[portable-script exit record](sdk-native-evidence/verification.json). [Provenance](sdk-native-evidence/provenance.json)
distinguishes the retained original observations from the portable import/output changes and added structural assertions.

## Native call chain supported by these APIs

```text
Dataset.evaluate(task, { repeat, maxConcurrency, metadata, signal })
  → task-local MemorySessionRepo.create OR same-repo JsonlSessionRepo.fork
  → AgentHarness.create → harness.lane → lane.prompt
  → native LaneSnapshot / Entry / required native hook observations
  → domain Evaluator → ReportEvaluator → renderReport + native report JSON
```

`AgentHarness.create` is the public factory. `lane.prompt` already performs accept and drive with retry waiting;
ordinary synchronous-model evals do not need a second polling/execution loop. Rejected, terminal and suspended
results remain distinct; a deferred response cannot count as success. [Public API][pi-api], [lane implementation][pi-lane].
Production and eval use the same model configuration, harness, tools, hooks and domain functions. Deterministic
selection exercises the production selection function and native custom entry, not a synthetic model tool.

Evaluators can inspect native snapshots and entries directly. When argument correctness needs the actual
executed parameters, the native `after_tool` hook supplies `cleared.args`; a tool-result message does not
intrinsically contain the old spec's assumed settled-parameter witness. [Actual hook invocation][pi-tools].
Do not preserve TranscriptResult, an entry-to-old-step converter, synthetic spans or a staging runner to avoid
rewriting evaluators. A product projection over native entries is domain code, not a legacy eval interface.

Recorded prefixes can use the official JSONL repository and NodeExecutionEnv filesystem directly: open and
fork within that repository. Local files do not require an agent database. Record each source at the intended
prefix boundary; a later tree fork cannot reconstruct earlier mutable state. [JSONL repository][pi-jsonl].
The native entry-ID probe supports references to committed results after tree fork. The SDK defines a tool's
`invocationId` as its reserved result-entry ID. [Tool invocation contract][pi-tool-types].
Append-only domain history can use native entries; bounded current state can use scalar values. A genuine
list-specific product requirement still needs an explicit decision because 0.85.1 does not copy lists.

## Product rules that remain ours

| Concern | SDK capability and remaining product responsibility |
|---|---|
| Execution | Dataset owns repetition, concurrency, task/evaluator failures. Avoid task retries that replace failed reliability attempts. |
| Correctness | Native boolean Evaluators; require every declared correctness assertion. Missing evidence fails, even when duration/setup checks pass. |
| pass^k | `caseGroups` supplies runs and failures, not pass^k. Exactly k passing attempts are required; known failure outranks incomplete. Entirely unstarted planned cases must not disappear from accounting. |
| Judge | Native LLMJudge requires a supplied model callback. Keep judge scores/errors outside the correctness veto and account for judge cost separately. |
| Baseline | Native reports/files/UI do not implement our capture freshness, non-starvation rules or stratified paired bootstrap: retain seed 309 and 2000 iterations. |
| Pricing | Pi supplies Usage, Model.cost tiers and calculateCost. Use recorded per-call costs; repricing aggregate tokens can misapply tiers or model changes. |
| Budgets | Daily quota, reservation/settlement, dollar caps, unknown prices and paid tool billing remain product policy. |
| Real tools | Real catalog/domain behavior and real web search remain required; SDKs do not supply Animichi's data or credentials. |

Sources: [Logfire evaluation types][lf-types], [group aggregation semantics][lf-report], [BYO LLMJudge][lf-judge],
[Pi Usage/model rates][pi-ai-types], [Pi calculateCost][pi-cost]. Native average/pass-rate functions do not enforce
required-name coverage. MaxDuration is post-hoc, and Dataset's signal does not automatically interrupt an
in-flight task; connect required cancellation to Pi's context. [Evaluate options][lf-types].

The three suites, four case-retirement rules, mutation evidence, selection equivalence and actual new-SUT
baseline remain product acceptance obligations. “No agent database” does not remove the canonical spec's
local catalog/test-Postgres data plane or authorize fake tools. Historical artifacts remain archived.

## Existing baseline dependency

[#1560](https://github.com/lifeodyssey/animichi/issues/1560) and the
[owner's #1515 comment](https://github.com/lifeodyssey/animichi/issues/1515#issuecomment-5598216249)
record “merge #1515/PR #1527 first” as a coordination decision. This research does not remove that dependency.
Technically, the new native task/report/SUT can capture and self-compare its own repeat=1 baseline without
merging or executing the old staging/Python mechanism. Preserve its useful capture and comparison safeguards,
not its obsolete parsers or runtime interfaces. Any dependency amendment belongs in the canonical coordination record.

[pi-api]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/agent-harness.ts
[pi-memory]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/session/memory.ts
[pi-fork]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/session/fork.ts
[pi-doc]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/docs/harness.md
[pi-session]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/session/types.ts
[pi-lane]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/runtime/lane.ts
[pi-tools]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/runtime/drive/tools.ts
[pi-jsonl]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/session/jsonl/repo.ts
[pi-tool-types]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/types.ts
[pi-ai-types]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/types.ts
[pi-cost]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/models.ts
[lf-dataset]: https://github.com/pydantic/logfire-js/blob/3ed526d861e530d9b8d86c562a5fb8e69e4534a9/packages/logfire-api/src/evals/Dataset.ts
[lf-types]: https://github.com/pydantic/logfire-js/blob/3ed526d861e530d9b8d86c562a5fb8e69e4534a9/packages/logfire-api/src/evals/types.ts
[lf-report]: https://github.com/pydantic/logfire-js/blob/3ed526d861e530d9b8d86c562a5fb8e69e4534a9/packages/logfire-api/src/evals/reporting.ts
[lf-analysis]: https://github.com/pydantic/logfire-js/blob/3ed526d861e530d9b8d86c562a5fb8e69e4534a9/packages/logfire-api/src/evals/ReportEvaluator.ts
[lf-judge]: https://github.com/pydantic/logfire-js/blob/3ed526d861e530d9b8d86c562a5fb8e69e4534a9/packages/logfire-api/src/evals/builtins/LLMJudge.ts
