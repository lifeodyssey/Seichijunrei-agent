/**
 * The metric columns ONE run can report (#1381).
 *
 * `metricNames` is the port of Python's list and takes only decisions; this is
 * where the facts behind those decisions are read. One is the dataset's
 * (`expect_nonempty`, which Python reads the same way); the other two are the
 * RUN's. `argument_correctness` needs a second witness the deployed edge
 * publishes, so a run against a deploy without #1381 — or one whose every
 * transcript read failed — computed it for nobody, and Python has no
 * equivalent. `step_efficiency` has no denominator on a turn that took no step
 * when the case required one (#1439), so a run in which every turn refused —
 * an unseeded `phase1c_selection_v1` arm — computed that one for nobody either.
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

/** True when at least one case was offered the settled params. One case is
 * enough: the metric is then computed for that case and the column is real. */
function anyParamsRecorded(report: AgentEvalReport): boolean {
  return report.cases.some((entry) => entry.output.paramsRecorded);
}

/** True when at least one case actually scored `step_efficiency` (#1439). The
 * emitted score is read rather than the rule re-derived: `StepEfficiency` owns
 * when the metric applies, and a second copy of that decision here would be a
 * second place for it to be wrong. */
function anyStepEfficiency(report: AgentEvalReport): boolean {
  return report.cases.some((entry) => 'step_efficiency' in entry.scores);
}

export function runMetricNames(options: RunMetricOptions): string[] {
  return metricNames({
    hasNonemptyCases: options.hasNonemptyCases,
    hasParamsRecorded: anyParamsRecorded(options.report),
    hasMeasuredSteps: anyStepEfficiency(options.report),
    l3Enabled: options.l3Enabled,
  });
}
