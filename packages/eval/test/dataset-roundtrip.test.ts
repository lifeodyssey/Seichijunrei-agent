import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { EXPORTED_DATASETS, exportedCaseCount } from '../src/dataset-sets.ts';
import { EVALUATOR_NAMES } from '../src/evaluator-names.ts';
import { caseViewPath, loadExportedDataset } from '../src/dataset-roundtrip.ts';

/**
 * The Python-side view of one exported set: written from the dataclasses, not
 * from pydantic-evals' serializer, so it is an independent expectation for
 * what `Dataset.fromFile` must have produced.
 */
interface CaseView {
  evaluators: EvaluatorSpecView[];
  expected_output: unknown;
  inputs: unknown;
  metadata: unknown;
  name: string;
}

interface EvaluatorSpecView {
  arguments: unknown;
  name: string;
}

interface DatasetView {
  cases: CaseView[];
  evaluators: EvaluatorSpecView[];
  name: string;
}

/**
 * The two session seeds #1398 retired. Neither harness ever read them — Python's
 * `_seed_tool_state` has no `last_search_data` branch and nothing reads the
 * `last_location` it assigns, and no `/v1/chat` body carries either — so a case
 * carrying one reads as a trajectory prefix that never existed.
 */
const RETIRED_SEED_KEYS = ['last_search_data', 'last_location'] as const;

function pythonView(setName: string): DatasetView {
  return JSON.parse(readFileSync(caseViewPath(setName), 'utf8')) as DatasetView;
}

for (const { caseCount, name } of EXPORTED_DATASETS) {
  /** The count an UNCAPPED run of this set has, which is what
   * `gate-run/baseline-capture.ts` tells a full run from a `--limit` one by
   * (#1515). It answers off this list rather than off the file. */
  void test(`${name}: exportedCaseCount answers the pinned count`, () => {
    assert.equal(exportedCaseCount(name), caseCount);
  });

  void test(`${name}: loads through Dataset.fromFile with the exported case count`, async () => {
    const dataset = await loadExportedDataset(name);

    assert.equal(dataset.name, name);
    assert.equal(dataset.cases.length, caseCount);
    assert.equal(pythonView(name).cases.length, caseCount);
  });

  void test(`${name}: dataset-level evaluator specs match the Python specs`, async () => {
    const dataset = await loadExportedDataset(name);

    assert.deepStrictEqual(
      dataset.evaluators.map((evaluator) => evaluator.getSpec()),
      pythonView(name).evaluators,
    );
    assert.deepEqual(
      dataset.evaluators.map((evaluator) => evaluator.getSpec().name),
      [...EVALUATOR_NAMES],
    );
  });

  void test(`${name}: every case deep-equals the Python case`, async () => {
    const dataset = await loadExportedDataset(name);

    const loaded = dataset.cases.map((testCase) => ({
      evaluators: testCase.evaluators.map((evaluator) => evaluator.getSpec()),
      expected_output: testCase.expectedOutput,
      inputs: testCase.inputs,
      metadata: testCase.metadata,
      name: testCase.name,
    }));
    assert.deepStrictEqual(loaded, pythonView(name).cases);
  });

  void test(`${name}: no case carries a retired session seed`, async () => {
    const dataset = await loadExportedDataset(name);

    const carriers = dataset.cases.filter((testCase) =>
      RETIRED_SEED_KEYS.some((key) => key in (testCase.inputs.context ?? {})),
    );
    assert.deepStrictEqual(
      carriers.map((testCase) => testCase.name),
      [],
    );
  });
}

void test('a set nobody exported has no case count to answer with', () => {
  assert.throws(() => exportedCaseCount('agent_eval_v4'), RangeError);
});
