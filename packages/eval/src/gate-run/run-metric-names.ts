/**
 * The metric columns ONE run can report (#1381).
 *
 * `metricNames` is the port of Python's list and takes only decisions; this is
 * where the facts behind those decisions are read. One is the dataset's
 * (`expect_nonempty`, which Python reads the same way); the other two are the
 * RUN's. `argument_correctness` needs a second witness the deployed edge
 * publishes, so a run against a deploy without #1381 — or one whose every
 * transcript read failed — computed it for nobody. `step_efficiency` has no
 * denominator on a turn that took no step when the case required one (#1439),
 * so a run in which every turn refused — an unseeded `phase1c_selection_v1`
 * arm — computed that one for nobody either.
 *
 * BOTH RUN FACTS ARE READ OFF THE EMITTED SCORES (#1462). This one used to ask
 * whether the transcript read had OFFERED a second witness
 * (`TranscriptResult.paramsRecorded`), which was the same question until
 * `ArgumentCorrectness` stopped scoring the runtime's own bypass steps. A
 * SEEDED `phase1c_selection_v1` arm is five cases and all five are bypasses:
 * every read publishes its `steps` array and no case scores the metric, so the
 * offer-based rule named a column the run does not carry and `aggregateScores`
 * — strict on purpose — threw `Missing metric(s): argument_correctness` on a
 * perfectly healthy run. Reading the score is also what makes this the twin of
 * `apps/agent/src/animichi/tests/eval/run_metric_names.py:40` again, and what
 * `makeGateRunSettings` in `test/gated-run.ts` already did.
 *
 * It lives in `src/` rather than in `scripts/eval-gate.ts` because dropping a
 * metric is a gate decision: the column it removes is a column the result file
 * does not carry and the baseline comparison does not make. A script deciding
 * that would be a verdict nothing tests.
 */
import { metricNames } from '../metric-names.ts';
import type { AgentEvalReport } from './gate-run-result.ts';

export interface RunMetricOptions {
  readonly report: AgentEvalReport;
  /** Whether any case in the DATASET asked for a nonempty result. */
  readonly hasNonemptyCases: boolean;
  readonly l3Enabled: boolean;
}

/** True when at least one case actually scored the metric. One case is enough:
 * the column is then a real measurement of that case. The emitted score is read
 * rather than the rule re-derived — each evaluator owns when its own metric
 * applies, and a second copy of that decision here would be a second place for
 * it to be wrong. */
function anyCaseScored(report: AgentEvalReport, metric: string): boolean {
  return report.cases.some((entry) => metric in entry.scores);
}

export function runMetricNames(options: RunMetricOptions): string[] {
  return metricNames({
    hasNonemptyCases: options.hasNonemptyCases,
    hasParamsRecorded: anyCaseScored(options.report, 'argument_correctness'),
    hasMeasuredSteps: anyCaseScored(options.report, 'step_efficiency'),
    l3Enabled: options.l3Enabled,
  });
}
