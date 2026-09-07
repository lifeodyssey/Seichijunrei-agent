/**
 * The selection cases of the two real sets, read the way the runner reads them
 * (#1439).
 *
 * The evaluator numbers are Python's and are proved by `evaluator-parity`; what
 * this file asserts is structural, about the real dataset rather than a
 * synthetic scenario: which chain each of these cases accepts, and how many
 * steps it is measured against. Both were the ground truth the card was opened
 * on — `acceptedChainsForCase` yielded ONLY the empty chain for all five, so a
 * turn that called nothing was a perfect trajectory, while
 * `D3_place_selection_radius` scored 0.0 for making the one call its stage names.
 * The four `plan_multi` cases kept that inversion after #1439, and #1454
 * measured why: their stage publishes one tool part of its own, so the empty
 * chain alone scored the two turns that FAILED 1.0 and the two that did the
 * work 0.0. `plan_selected` carried the same stale row until #1461, and it is
 * measured here on `agent_eval_v3`, the set its fifteen cases live in.
 *
 * test-type: unit (committed fixture, no network, no clock).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadExportedDataset } from '../src/dataset-roundtrip.ts';
import type { ExportedAgentExpected } from '../src/dataset-roundtrip.ts';
import { acceptableMinSteps, acceptedChainsForCase } from '../src/evaluators/accepted-chains.ts';
import type { TranscriptResult } from '../src/evaluators/index.ts';
import { makeTranscriptResult } from './gated-run.ts';

const DATASET = await loadExportedDataset('phase1c_selection_v1');
/** The 662-case baseline set, the only one carrying `plan_selected` cases (#1461). */
const BASELINE = await loadExportedDataset('agent_eval_v3');

/** A turn that published no call at all — the unseeded arm's own transcript. */
const REFUSAL: TranscriptResult = makeTranscriptResult('search_nearby', 'ja');

function expectationOf(name: string, set = DATASET): ExportedAgentExpected | undefined {
  const found = set.cases.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`no case named ${name} in the loaded set`);
  }
  return found.metadata;
}

void test('the place selection accepts the call its stage names, not the empty chain', () => {
  const chains = acceptedChainsForCase(expectationOf('D3_place_selection_radius'));

  assert.deepEqual(chains, [['search_nearby']]);
});

void test('the multi selections accept the step the wire publishes as well as the empty chain', () => {
  const multi = [
    'D3_multi_success_two',
    'D3_multi_success_single',
    'D3_multi_terminal_empty',
    'D3_multi_partial_success',
  ];

  for (const name of multi) {
    assert.deepEqual(acceptedChainsForCase(expectationOf(name)), [[], ['plan_multi']]);
  }
});

void test('the point selections accept the step the wire publishes as well as the empty chain', () => {
  const measured = ['K1_ja_001', 'K1_en_002'];

  for (const name of measured) {
    assert.deepEqual(acceptedChainsForCase(expectationOf(name, BASELINE)), [
      [],
      ['plan_selected'],
    ]);
  }
});

void test('every `plan_selected` case of the baseline set accepts the published step', () => {
  const selected = BASELINE.cases.filter(
    (entry) => entry.metadata?.acceptable_stages.includes('plan_selected') === true,
  );

  assert.equal(selected.length, 15);
  for (const entry of selected) {
    assert.deepEqual(acceptedChainsForCase(entry.metadata), [[], ['plan_selected']]);
  }
});

void test('every one of the five is measured against at least one step', () => {
  const minima = DATASET.cases.map((entry) =>
    Math.min(...acceptableMinSteps(entry.inputs, entry.metadata, REFUSAL)),
  );

  assert.equal(DATASET.cases.length, 5);
  assert.ok(minima.every((minimum) => minimum > 0));
});
