/**
 * The outage gate, and Python's own sentences for it (#1496).
 *
 * A staging turn that came back as the edge's error envelope publishes no
 * `data-response` part, so `transcriptResultOf` gives it the crashed intent and
 * the driver files an EVALUATED case — one `errorRateGate` cannot count, since
 * its numerator is `report.failures`. A run where every turn did that used to
 * report the seven columns a stepless turn still emits and pass.
 *
 * test-type: unit (oracle rows + canned report, no network).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gateRunResultOf } from '../src/gate-run/gate-run-result.ts';
import {
  DEPLOYED_AGENT_TIER,
  PROVIDER_OUTAGE_CEILING,
  providerOutageFailure,
  starvedCasesOf,
} from '../src/gate-run/provider-outage.ts';
import { PYTHON_BASELINE_MODEL } from '../src/gate-run/python-baseline.ts';
import { runMetricNames } from '../src/gate-run/run-metric-names.ts';
import { oracleEntryNamed, readStatsOracle } from '../src/gate/stats-oracle.ts';
import { CRASHED_INTENT } from '../src/turn-transcript.ts';
import { makeCannedReport } from './canned-report.ts';
import { GATED_DATASET, GENERATED_AT } from './gated-run.ts';

const OUTAGE_ROWS = readStatsOracle().provider_outage_gates;
const SCORES = { tool_correctness: 1 };

for (const name of OUTAGE_ROWS.map((row) => row.name)) {
  void test(`the ${name} row says what Python's gate says`, () => {
    const row = oracleEntryNamed(OUTAGE_ROWS, name);

    assert.equal(
      providerOutageFailure(row.starved, row.evaluated, row.answered_by, row.ceiling),
      row.failure,
    );
  });
}

void test('the ceiling is the one Python published its rows against', () => {
  const atCeiling = oracleEntryNamed(OUTAGE_ROWS, 'at_ceiling');

  assert.equal(atCeiling.ceiling, PROVIDER_OUTAGE_CEILING);
  assert.equal(atCeiling.starved / atCeiling.evaluated, PROVIDER_OUTAGE_CEILING);
});

/**
 * Python's second ceiling has no counterpart here, and that is a decision
 * rather than an omission: `gate-exit-code.ts` says this runner never writes
 * the record it is judged by, so the lower ceiling — which exists to stop a
 * starved run MINTING a baseline — would guard a write that never happens
 * (#1499). The rows still carry it, so both lanes' sentences replay here.
 */
void test('the lower ceiling belongs to a lane this runner does not have', () => {
  const baselineLane = oracleEntryNamed(OUTAGE_ROWS, 'baseline_lane_at_ceiling');

  assert.ok(baselineLane.ceiling < PROVIDER_OUTAGE_CEILING);
  assert.equal(
    providerOutageFailure(3, 100, DEPLOYED_AGENT_TIER, PROVIDER_OUTAGE_CEILING),
    null,
  );
  assert.ok(
    providerOutageFailure(3, 100, DEPLOYED_AGENT_TIER, baselineLane.ceiling) !== null,
  );
});

/** A run of `starved` crashed turns and `answered` ordinary ones. */
function reportOf(starved: number, answered: number) {
  return makeCannedReport([
    ...Array.from({ length: starved }, (_unused, index) => ({
      name: `starved-${String(index)}`,
      intent: CRASHED_INTENT,
      scores: SCORES,
    })),
    ...Array.from({ length: answered }, (_unused, index) => ({
      name: `answered-${String(index)}`,
      scores: SCORES,
    })),
  ]);
}

void test('a crashed turn is an evaluated case, which is why it needs counting', () => {
  const report = reportOf(9, 1);

  assert.equal(report.failures.length, 0);
  assert.equal(starvedCasesOf(report), 9);
});

void test('a wholly starved run fails, naming the share and the surface', () => {
  const result = gateRunResultOf(reportOf(10, 0), settings(10));

  assert.deepEqual(result.failures, [
    providerOutageFailure(10, 10, DEPLOYED_AGENT_TIER, PROVIDER_OUTAGE_CEILING),
  ]);
});

/** `PYTHON_BASELINE_MODEL` names the record this run is COMPARED against, and
 * the deploy publishes nothing about what actually answered it
 * (`python-baseline.ts`). A sentence blaming it would be a claim the wire never
 * made. */
void test('the sentence blames a surface, never the baseline record\'s model', () => {
  const result = gateRunResultOf(reportOf(10, 0), settings(10));

  assert.equal(result.baseline_model, PYTHON_BASELINE_MODEL);
  assert.ok(!result.failures[0]?.includes(PYTHON_BASELINE_MODEL));
});

void test('one starved case in ten leaves the run judgeable', () => {
  const result = gateRunResultOf(reportOf(1, 9), settings(10));

  assert.deepEqual(result.failures, []);
});

/**
 * The seven columns a starved turn still scores. `argument_correctness` is the
 * one it cannot: `ArgumentCorrectness` emits nothing for a turn with no
 * successful call. This is the shape of the 2026-09-08 nightly's report.
 */
const STARVED_SCORES = {
  tool_correctness: 1,
  trajectory_match: 1,
  max_tool_calls: 1,
  data_keys_present: 1,
  locale_match: 1,
  nonempty_results: 0,
  step_efficiency: 1,
};

function starvedRun(count: number) {
  return makeCannedReport(
    Array.from({ length: count }, (_unused, index) => ({
      name: `starved-${String(index)}`,
      intent: CRASHED_INTENT,
      scores: STARVED_SCORES,
    })),
  );
}

/**
 * The whole point, as a run rather than as an argument.
 *
 * The column no case scored is not the run's to report — `runMetricNames` reads
 * the emitted scores (#1462), so the list a starved run derives for itself
 * carries the seven above and not the eighth. That closes the nightly's throw
 * (`Missing metric(s): argument_correctness` out of `aggregateScores`, which is
 * strict on purpose) at its source; the outage gate still has to be reached
 * BEFORE the comparison, because a starved run must be reported rather than
 * compared — its numbers measure the outage, not the agent (#1496, #1510).
 */
void test('a starved run reports the outage, not the column it starved', () => {
  const report = starvedRun(10);
  const metrics = runMetricNames({ report, hasNonemptyCases: true, l3Enabled: false });
  assert.ok(!metrics.includes('argument_correctness'));

  const result = gateRunResultOf(report, { ...settings(10), metricNames: metrics });

  assert.deepEqual(result.failures, [
    providerOutageFailure(10, 10, DEPLOYED_AGENT_TIER, PROVIDER_OUTAGE_CEILING),
  ]);
  assert.deepEqual(result.scores, {});
  assert.deepEqual(result.metrics, []);
});

function settings(caseCount: number) {
  return {
    dataset: GATED_DATASET,
    caseCount,
    metricNames: [],
    baseline: null,
    baselineModel: PYTHON_BASELINE_MODEL,
    baselineFailures: [],
    baselineWarnings: [],
    strata: {},
    strataWarnings: [],
    now: () => GENERATED_AT,
  };
}
