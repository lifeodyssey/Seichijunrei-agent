import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { EVALUATOR_VERSION } from '../src/evaluators/agent-evaluator.ts';
import { baselineRecordText, parseBaselineRecord } from '../src/gate/baseline-record.ts';
import { baselinePath, writeBaselineRecord } from '../src/gate/baseline-store.ts';
import {
  oracleEntryAt,
  oracleEntryNamed,
  PYTHON_BASELINES_DIR,
  PYTHON_BASELINE_LAYER,
  PYTHON_BASELINE_MODEL,
  readStatsOracle,
} from '../src/gate/stats-oracle.ts';

const oracle = readStatsOracle();
const written = oracleEntryAt(oracle.written_records, 0);
const baselineFile = baselinePath({
  layer: PYTHON_BASELINE_LAYER,
  modelId: PYTHON_BASELINE_MODEL,
  baselinesDir: PYTHON_BASELINES_DIR,
});

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'animichi-baseline-'));
}

for (const entry of oracle.baseline_paths) {
  void test(`${entry.model_id} becomes ${entry.filename}`, () => {
    const location = { layer: entry.layer, modelId: entry.model_id, baselinesDir: '/tmp' };
    assert.equal(baselinePath(location), `/tmp/${entry.filename}`);
  });
}

for (const [index, entry] of oracle.written_records.entries()) {
  void test(`written record ${String(index)} is byte-identical to Python's`, () => {
    assert.equal(`${baselineRecordText(entry.record)}\n`, entry.text);
  });
}

void test('a Python-written record survives a TS read and rewrite unchanged', () => {
  const text = readFileSync(baselineFile, 'utf8');
  const record = parseBaselineRecord(text) ?? written.record;
  assert.equal(`${baselineRecordText(record)}\n`, text);
});

/** The rule `baseline-store.ts` deliberately does NOT make about every record:
 * an absent version is tolerated there, so the pinned record's own version is
 * pinned here, where it is a fact about one file (#1303). */
void test('the committed Python baseline names the vocabulary this runner scores in', () => {
  const record = parseBaselineRecord(readFileSync(baselineFile, 'utf8'));
  assert.equal(record?.evaluator_version, EVALUATOR_VERSION);
});

void test('the committed Python baseline parses to the record Python gates with', () => {
  const record = parseBaselineRecord(readFileSync(baselineFile, 'utf8'));
  assert.deepEqual(record, oracleEntryNamed(oracle.bootstrap_gates, 'real_baseline_subset').baseline);
});

void test('writing lands the record where the path says, directory and all', () => {
  const directory = join(scratchDir(), 'nested');
  const location = { layer: 'agent_l4_trajectory', modelId: 'a:model', baselinesDir: directory };
  const path = writeBaselineRecord(written.record, location);
  assert.equal(readFileSync(path, 'utf8'), written.text);
});

void test('a record without the optional fields takes Python\'s defaults', () => {
  const record = parseBaselineRecord(
    '{"schema_version":2,"model":"m","dataset":"d","tier":"t","case_count":1,"evaluated_count":1,"scores":{},"cases":{}}',
  );
  assert.deepEqual(record, {
    schema_version: 2,
    model: 'm',
    dataset: 'd',
    tier: 't',
    evaluator_version: null,
    repeat: 1,
    case_count: 1,
    evaluated_count: 1,
    errored_count: 0,
    scores: {},
    cases: {},
    note: null,
  });
});

void test('an omitted schema_version is the v2 default, as pydantic reads it', () => {
  const text = written.text.replace('"schema_version": 2,\n  ', '');
  assert.deepEqual(parseBaselineRecord(text), written.record);
});

void test('a v1 record is not a v2 record', () => {
  const text = written.text.replace('"schema_version": 2', '"schema_version": 1');
  assert.equal(parseBaselineRecord(text), null);
});

void test('a non-numeric score is refused rather than coerced', () => {
  const text = written.text.replace('"metric": 0.0', '"metric": "0.0"');
  assert.equal(parseBaselineRecord(text), null);
});

void test('a truncated file is refused rather than half-read', () => {
  assert.equal(parseBaselineRecord('{"schema_version": 2, "model"'), null);
});
