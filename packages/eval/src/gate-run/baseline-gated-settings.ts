import { EVALUATOR_VERSION } from '../evaluators/agent-evaluator.ts';
import { readBaselineRecord, type BaselineExpectations, type BaselineLocation } from '../gate/baseline-store.ts';
import type { GateRunSettings } from './gate-run-result.ts';

/** Everything one gate run knows about itself before any baseline is read. */
export type RunUnderGate = Omit<
  GateRunSettings,
  'baseline' | 'baselineModel' | 'baselineFailures' | 'baselineWarnings'
>;

/** What the run expects of a baseline before it will compare with it. */
function baselineExpectations(run: RunUnderGate): BaselineExpectations {
  return {
    caseCount: run.caseCount,
    metrics: run.metricNames,
    evaluatorVersion: EVALUATOR_VERSION,
  };
}

/**
 * The join `scripts/eval-gate.ts` used to make inline (#1341): a baseline read
 * on disk becomes the settings the gate decides with. The read's blocking half
 * is carried, not dropped — `baselineFailures` is the one way a damaged
 * committed record exits 1, so a function that emptied it would turn a red
 * regression gate into a green one.
 */
export function gateRunSettingsFromBaseline(
  location: BaselineLocation,
  run: RunUnderGate,
): GateRunSettings {
  const read = readBaselineRecord(location, baselineExpectations(run));
  return {
    ...run,
    baseline: read.record,
    baselineModel: location.modelId,
    baselineFailures: read.failures,
    baselineWarnings: read.warnings,
  };
}
