/**
 * The metric names a run reports, in the order Python reports them.
 *
 * Order matters: the baseline files, the gate, and the report tables are all
 * keyed positionally off this list, so the TS runner has to agree with
 * `eval_harness.metric_names` name for name and slot for slot. The committed
 * dump in `fixtures/evaluator-oracle.json` is what proves it.
 *
 * `nonempty_results` drops out when the dataset carries no `expect_nonempty`
 * case — the evaluator returns `{}` for every case, so a column would be
 * permanently empty rather than zero.
 *
 * `argument_correctness` drops out on the same terms, for a reason Python never
 * had (#1381): its second witness is published by the EDGE, so a run against a
 * deploy that publishes no settled step — or a run whose every transcript read
 * failed — computes the metric for no case at all. Keeping the column then
 * would make `aggregateScores` throw `Missing metric(s)` and take the other
 * seven down with it, reporting a whole run as broken because one measurement
 * was unavailable. It is a per-RUN toggle, not a per-dataset one: nothing in
 * the cases decides it.
 *
 * `step_efficiency` drops out on the same per-RUN terms since #1439. It is no
 * longer scored for a turn that took no step on a case whose every acceptable
 * ideal is at least one — there is no denominator there — so a run in which
 * every turn refused to act (an unseeded `phase1c_selection_v1` arm is exactly
 * that) computes it for nobody. Python can reach the same state and raises;
 * dropping the column keeps the other seven metrics reportable, which is the
 * whole point of the toggle above.
 */

const OFFICIAL_METRIC_NAMES: readonly string[] = [
  'argument_correctness',
  'tool_correctness',
  'trajectory_match',
  'max_tool_calls',
];

const KEPT_METRIC_NAMES: readonly string[] = [
  'data_keys_present',
  'locale_match',
  'nonempty_results',
  'step_efficiency',
];

/** The L3 outcome judges, appended only when `EVAL_L3` opts them in. */
const L3_METRIC_NAMES: readonly string[] = ['task_completion', 'hallucination_check'];

export interface MetricNameOptions {
  readonly hasNonemptyCases: boolean;
  /** Whether any case's transcript read offered the settled params at all
   * (`TranscriptResult.paramsRecorded`). Python's runner always recorded them,
   * so its own list is this list with the flag true. */
  readonly hasParamsRecorded: boolean;
  /** Whether any case in the run scored `step_efficiency` at all. False means
   * every turn took no step on a case that required one (#1439). */
  readonly hasMeasuredSteps: boolean;
  readonly l3Enabled: boolean;
}

export function metricNames(options: MetricNameOptions): string[] {
  const official = OFFICIAL_METRIC_NAMES.filter(
    (name) => name !== 'argument_correctness' || options.hasParamsRecorded,
  );
  const kept = KEPT_METRIC_NAMES.filter((name) => keptName(name, options));
  const names = [...official, ...kept];
  return options.l3Enabled ? [...names, ...L3_METRIC_NAMES] : names;
}

function keptName(name: string, options: MetricNameOptions): boolean {
  if (name === 'nonempty_results') {
    return options.hasNonemptyCases;
  }
  return name !== 'step_efficiency' || options.hasMeasuredSteps;
}
