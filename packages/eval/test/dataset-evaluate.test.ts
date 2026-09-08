import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Dataset } from 'logfire/evals';
import type { Case, ReportCase } from 'logfire/evals';

import type {
  ExportedAgentExpected,
  ExportedAgentInput,
} from '../src/dataset-roundtrip.ts';
import { loadExportedDataset } from '../src/dataset-roundtrip.ts';
import type { TranscriptResult } from '../src/evaluators/index.ts';
import { metricNames } from '../src/metric-names.ts';

/**
 * End to end through `logfire/evals`' own driver: the eight names in the
 * exported file resolve to the eight real evaluators, and a case's `scores`
 * comes back keyed by the metric names Python reports — not by the class names.
 */

const SELECTION_SET = 'phase1c_selection_v1';
/** The one case in that set tagged `expect_nonempty`, so all eight apply. */
const CASE_NAME = 'D3_multi_success_two';

type SelectionCase = Case<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>;

/** A routed multi-selection: two candidates ordered into one grounded route. */
function makeRoutedMultiSelection(): TranscriptResult {
  const response = {
    data: {
      itinerary: { ordered_points: ['p0', 'p1', 'p2', 'p3'] },
      results: { row_count: 9 },
    },
    intent: 'plan_multi',
    message: 'Both anime are covered by this route.',
    success: true,
  };
  return {
    dataKeys: ['results', 'route'],
    intent: response.intent,
    locale: 'en',
    message: response.message,
    paramsRecorded: true,
    response,
    runStatus: 'succeeded',
    priorTrajectory: [],
    stepCount: 1,
    success: true,
    trajectory: [
      {
        args: { result_ref: 'search:multi:1' },
        origin: 'model',
        output: { status: 'ok' },
        params: { result_ref: 'search:multi:1' },
        status: 'ok',
        toolName: 'plan_route',
      },
    ],
  };
}

async function reportOneCase(): Promise<ReportCase<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>> {
  const loaded = await loadExportedDataset<TranscriptResult>(SELECTION_SET);
  const only = loaded.cases.filter((entry: SelectionCase) => entry.name === CASE_NAME);
  const dataset = new Dataset({ cases: only, evaluators: loaded.evaluators, name: CASE_NAME });

  const report = await dataset.evaluate(makeRoutedMultiSelection);
  const [first] = report.cases;
  assert.ok(first, 'the case ran');
  return first;
}

void test('a fixture case scored by the real evaluators reports the eight metrics', async () => {
  const scored = await reportOneCase();

  assert.deepEqual(
    Object.keys(scored.scores).sort(),
    [
      ...metricNames({
        hasNonemptyCases: true,
        hasParamsRecorded: true,
        hasMeasuredSteps: true,
        l3Enabled: false,
      }),
    ].sort(),
  );
});

void test('each reported score carries its evaluator spec and version', async () => {
  const scored = await reportOneCase();
  const versions = Object.values(scored.scores).map((result) => result.evaluator_version);

  assert.deepEqual(versions, new Array(versions.length).fill('official-v2'));
});
