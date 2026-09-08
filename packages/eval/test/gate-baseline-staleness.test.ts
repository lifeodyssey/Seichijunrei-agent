import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { BaselineRecord } from '../src/gate/baseline-record.ts';
import {
  baselinePath,
  readBaselineRecord,
  writeBaselineRecord,
  type BaselineLocation,
  type BaselineReadResult,
} from '../src/gate/baseline-store.ts';
import {
  oracleEntryAt,
  oracleEntryNamed,
  readStatsOracle,
  type OracleStalenessCase,
} from '../src/gate/stats-oracle.ts';
import { BASELINE_LAYER, BASELINE_MODEL } from '../src/gate-run/baseline-identity.ts';

const oracle = readStatsOracle();
/** `baseline_oracle.py`'s `STALE_LAYER` / `STALE_MODEL`, which are the same two
 * strings the identity module pins. The oracle's warnings interpolate them, so
 * reading them from one place is what keeps the replayed text identical. */
const LAYER = BASELINE_LAYER;
const MODEL = BASELINE_MODEL;

function scratchLocation(): BaselineLocation {
  const baselinesDir = mkdtempSync(join(tmpdir(), 'animichi-staleness-'));
  return { layer: LAYER, modelId: MODEL, baselinesDir };
}

function readWritten(record: BaselineRecord, entry: OracleStalenessCase): BaselineReadResult {
  const location = scratchLocation();
  writeBaselineRecord(record, location);
  return readBaselineRecord(location, {
    caseCount: entry.expected_case_count ?? undefined,
    metrics: entry.expected_metrics ?? undefined,
  });
}

for (const entry of oracle.baseline_staleness) {
  void test(`${entry.name}: the same warnings Python logs`, () => {
    const result = readWritten(entry.record, entry);
    assert.deepEqual(result.warnings, entry.warnings);
  });

  void test(`${entry.name}: the record is kept or dropped as Python decides`, () => {
    const result = readWritten(entry.record, entry);
    assert.equal(result.record !== null, entry.loaded);
  });
}

void test('a missing baseline names the file it looked for', () => {
  const location = scratchLocation();
  const result = readBaselineRecord(location);
  assert.deepEqual(result, {
    record: null,
    failures: [],
    warnings: [`Missing baseline for ${LAYER}/${MODEL} at ${baselinePath(location)}`],
  });
});

/** Damaged on disk, not absent: a warning here would disable the regression
 * gate with a line indistinguishable from a legitimate first run (#1341). */
function readDamaged(text: string): BaselineReadResult {
  const location = scratchLocation();
  writeFileSync(baselinePath(location), text, 'utf8');
  return readBaselineRecord(location);
}

void test('an unreadable baseline is a failure, not a silent skip', () => {
  const result = readDamaged('{ not json');
  assert.equal(result.record, null);
  assert.deepEqual(result.warnings, []);
  assert.match(oracleEntryAt(result.failures, 0), /^Invalid baseline for /);
});

void test('a baseline written to another schema version fails the same way', () => {
  const fresh = oracleEntryNamed(oracle.baseline_staleness, 'fresh').record;
  const result = readDamaged(JSON.stringify({ ...fresh, schema_version: 3 }));
  assert.equal(result.record, null);
  assert.deepEqual(result.warnings, []);
  assert.match(oracleEntryAt(result.failures, 0), /^Invalid baseline for /);
});

void test('a fresh record is returned with nothing to say about it', () => {
  const entry = oracleEntryNamed(oracle.baseline_staleness, 'fresh');
  assert.deepEqual(readWritten(entry.record, entry).record, entry.record);
});
