import { loadCaseStrata, type CaseStrata } from '../gate/case-strata.ts';

/**
 * The run that loads its strata before it spends a turn (#1478).
 *
 * `loadCaseStrata` used to run inside `gatedResult`, i.e. after
 * `Dataset.evaluate` had taken every case's staging turns: a dataset the gate
 * could not stratify threw there, once the whole run was already paid for, and
 * no result file was written. Loading first is the entire point, so the order
 * lives in one named place both runners call rather than in a line someone can
 * move back up the file.
 *
 * `apps/agent/src/animichi/tests/eval/strata_first_run.py` is the same shape on
 * the Python side.
 */

/** One run's two halves, in the order they must happen. What the run returns
 * is not this module's business; the order is. */
export interface StrataFirstRun<Report> {
  readonly strata: CaseStrata;
  readonly report: Report;
}

/** Validate the strata, then run: a malformed dataset refuses unspent. */
export async function evaluateAfterStrata<Report>(
  datasetPath: string,
  evaluate: () => Promise<Report>,
): Promise<StrataFirstRun<Report>> {
  const strata = loadCaseStrata(datasetPath);
  return { strata, report: await evaluate() };
}
