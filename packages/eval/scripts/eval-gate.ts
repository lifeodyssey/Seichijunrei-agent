/**
 * Gate one staging run against the committed Python baseline (W3-5 prep #1327).
 *
 * `eval-staging.ts` runs a set and prints what came back; this runs the same
 * set and DECIDES about it — `bootstrapGate` + `errorRateGate` on the paired
 * scores, a result file under `results/`, and `run_agent_eval.py`'s exit code.
 * Two entries rather than a flag on one, because "look at a run" and "block on
 * a run" want different defaults and different blast radii.
 *
 * The composition root, like its sibling: `src/` shapes and decides, and this
 * is the only file here that reads a credential, touches the network, reads the
 * clock or writes a file. The door is `api-test/lane-origin.ts`, imported
 * rather than reimplemented (#1291, #1294) — see `staging-turn-task.ts`.
 *
 * IT NEVER WRITES A BASELINE. Python's uncapped run creates one when it finds
 * none; the whole point of the double run is to be judged by the Python
 * numbers, so a missing or stale baseline here is a warning and an ungated
 * report, never a fresh record to pass against. A baseline that is committed and
 * no longer parses is the one exception, and it exits 1 (`baseline-store.ts`):
 * damage that nobody can fix by re-running is not an ungated run.
 *
 * COST. `--dataset` defaults to the set the baseline covers, which is 662 cases
 * and every one of them a real staging turn on the QA identity. Use `--limit`
 * for a smoke run; a limited run cannot be gated (the baseline is stale for a
 * case count it does not describe, exactly as a capped Python run skips the
 * gate) and says so in its warnings.
 *
 * Usage (from the repo root):
 *
 *   CATALOG_API_ORIGIN=https://staging.animichi.com \
 *   STAGING_GATE_TOKEN=… NEON_AUTH_BASE_URL=… \
 *   QA_NEON_USER_EMAIL=… QA_NEON_USER_PASSWORD=… \
 *   pnpm --filter @animichi/eval run eval:gate -- --dataset agent_eval_heldout_v1 --limit 3
 */
import { parseArgs } from "node:util";

import { renderReport, type CaseLifecycleClass } from "logfire/evals";
import { laneFetch } from "edge-worker/api-test/lane-origin.ts";

import { checkedDatasetName } from "../src/dataset-sets.ts";
import {
  loadExportedDataset,
  type ExportedAgentExpected,
  type ExportedAgentInput,
  type ExportedDatasetHandle,
} from "../src/dataset-roundtrip.ts";
import { canonicalDatasetPath, type CaseStrata } from "../src/gate/case-strata.ts";
import { writeAttributionEvidence } from "../src/gate-run/attribution-evidence.ts";
import { analyseFailures } from "../src/gate-run/failure-attribution.ts";
import { gateRunSettingsFromBaseline } from "../src/gate-run/baseline-gated-settings.ts";
import { gateExitCode } from "../src/gate-run/gate-exit-code.ts";
import { gateRunResultOf, type AgentEvalReport, type GateRunResult } from "../src/gate-run/gate-run-result.ts";
import { pythonBaselineLocation } from "../src/gate-run/python-baseline.ts";
import { writeGateRunResult } from "../src/gate-run/result-file.ts";
import { runMetricNames } from "../src/gate-run/run-metric-names.ts";
import { evaluateAfterStrata } from "../src/gate-run/strata-first-run.ts";
import { neonAuthBearer, qaSignInFrom } from "../src/neon-auth-bearer.ts";
import { StagingBearer } from "../src/staging-bearer.ts";
import { seededPrefixLifecycle } from "../src/prefix-seeding-lifecycle.ts";
import { SeededSessions } from "../src/seeded-sessions.ts";
import { DEFAULT_MAX_CONCURRENCY, StagingTurnTask } from "../src/staging-turn-task.ts";
import type { TranscriptResult } from "../src/turn-transcript.ts";

/** The set the committed Python baseline describes; `run_agent_eval.py`'s default too. */
const DEFAULT_DATASET = "agent_eval_v3";

/** No L3 judge on this side: `build_l3_evaluators` is model-backed and the eight
 * ported evaluators are not. `metric_names(l3_enabled=False)` is what a TS run
 * can report, and the committed baseline was written without it either. */
const L3_ENABLED = false;

interface GateRunArgs {
  readonly dataset: string;
  readonly limit: number | null;
  readonly concurrency: number;
}

function positiveInteger(raw: string | undefined, flag: string): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${flag} must be a positive integer`);
  return value;
}

function runArgs(argv: readonly string[]): GateRunArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      dataset: { type: "string", default: DEFAULT_DATASET },
      limit: { type: "string" },
      concurrency: { type: "string" },
    },
  });
  return {
    dataset: checkedDatasetName(values.dataset),
    limit: positiveInteger(values.limit, "--limit"),
    concurrency: positiveInteger(values.concurrency, "--concurrency") ?? DEFAULT_MAX_CONCURRENCY,
  };
}

/** One QA sign-in, re-minted on age rather than read from a file. */
function stagingBearer(): StagingBearer {
  return new StagingBearer(neonAuthBearer(qaSignInFrom(process.env), fetch), () => Date.now());
}

/** The two halves of one run (E-1 #1380): the task that takes each case's
 * turns, and the lifecycle that gives a case with a `seeded_pending` its
 * starting point first. They share one bearer — an eval run is one sign-in —
 * and one register, which is how the prefix and the turn land in one session. */
interface StagingRun {
  readonly task: StagingTurnTask;
  readonly lifecycle: CaseLifecycleClass<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>;
}

function stagingRun(concurrency: number): StagingRun {
  const bearer = stagingBearer();
  const sessions = new SeededSessions();
  const task = new StagingTurnTask({
    door: laneFetch,
    bearer,
    turnId: () => `eval-${crypto.randomUUID()}`,
    maxConcurrency: concurrency,
    sessions,
  });
  const lifecycle = seededPrefixLifecycle<TranscriptResult>({
    door: laneFetch, bearer, sessions, sessionId: () => `eval-prefix-${crypto.randomUUID()}`,
  });
  return { task, lifecycle };
}

/** `METRIC_NAMES`, for this run: `nonempty_results` only counts when a case
 * asks for it, and `argument_correctness` only when the edge published the
 * settled params it is scored against (#1381). */
function gatedMetricNames(
  dataset: ExportedDatasetHandle<TranscriptResult>,
  report: AgentEvalReport,
): string[] {
  const hasNonemptyCases = dataset.cases.some((one) => one.metadata?.expect_nonempty === true);
  return runMetricNames({ report, hasNonemptyCases, l3Enabled: L3_ENABLED });
}

function gatedResult(
  report: AgentEvalReport,
  args: GateRunArgs,
  caseCount: number,
  metrics: string[],
  strata: CaseStrata,
): GateRunResult {
  return gateRunResultOf(
    report,
    gateRunSettingsFromBaseline(pythonBaselineLocation(), {
      dataset: args.dataset,
      caseCount,
      metricNames: metrics,
      strata: strata.byCase,
      strataWarnings: strata.warnings,
      now: () => new Date(),
    }),
  );
}

/**
 * The raw half of the failure attribution (E-4 #1383). The committed result
 * carries the REFERENCE and, by design, none of the text — so the analysis is
 * run again here to get at the text. That is the boundary working, not a
 * duplication to fold away: a `GateRunResult` that carried the evidence would
 * be a result file with the visitor's query in it. The destination is a
 * gitignored directory the eval lane uploads as a CI artifact
 * (`attribution-evidence.ts` says what that step must do).
 */
function announceEvidence(report: AgentEvalReport, result: GateRunResult): void {
  const path = writeAttributionEvidence(
    analyseFailures(report),
    result.failure_attribution.evidence_artifact,
  );
  process.stdout.write(`Attribution evidence written to: ${path}\n`);
}

/** `run_agent_eval._finish`, verbatim strings included. */
function announce(result: GateRunResult, path: string): void {
  process.stdout.write(`\nGate result written to: ${path}\n`);
  for (const warning of result.warnings) process.stderr.write(`${warning}\n`);
  if (result.failures.length > 0) {
    process.stderr.write(`Regression:\n${result.failures.join("\n")}\n`);
    return;
  }
  process.stdout.write("All gates passed.\n");
}

async function main(): Promise<void> {
  const args = runArgs(process.argv.slice(2));
  const dataset = await loadExportedDataset<TranscriptResult>(args.dataset);
  // Python caps the same way (`exec_tiers.cap_cases` under `EVAL_MAX_CASES`).
  if (args.limit !== null) dataset.cases = dataset.cases.slice(0, args.limit);
  const { task, lifecycle } = stagingRun(args.concurrency);
  // The strata load FIRST (#1478): a set the gate cannot stratify must refuse
  // before the first turn is paid for, not after the last one.
  const { strata, report } = await evaluateAfterStrata(canonicalDatasetPath(args.dataset), () =>
    dataset.evaluate(task.asTask(), { name: `gate_${args.dataset}`, progress: true, lifecycle }),
  );
  process.stdout.write(`${renderReport(report)}\n`);
  const metrics = gatedMetricNames(dataset, report);
  const result = gatedResult(report, args, dataset.cases.length, metrics, strata);
  announceEvidence(report, result);
  announce(result, writeGateRunResult(result));
  process.exitCode = gateExitCode(result);
}

await main();
