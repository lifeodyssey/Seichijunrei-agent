/**
 * The five `phase1c_selection_v1` cases, read the way the runner reads them (#1439).
 *
 * The evaluator numbers are Python's and are proved by `evaluator-parity`; what
 * this file asserts is structural, about the real dataset rather than a
 * synthetic scenario: which chain each of these cases accepts, and how many
 * steps it is measured against. Both were the ground truth the card was opened
 * on — `acceptedChainsForCase` yielded ONLY the empty chain for all five, so a
 * turn that called nothing was a perfect trajectory, while
 * `D3_place_selection_radius` scored 0.0 for making the one call its stage names.
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

/** A turn that published no call at all — the unseeded arm's own transcript. */
const REFUSAL: TranscriptResult = makeTranscriptResult('search_nearby', 'ja');

function expectationOf(name: string): ExportedAgentExpected | undefined {
  const found = DATASET.cases.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`no case named ${name} in phase1c_selection_v1`);
  }
  return found.metadata;
}

void test('the place selection accepts the call its stage names, not the empty chain', () => {
  const chains = acceptedChainsForCase(expectationOf('D3_place_selection_radius'));

  assert.deepEqual(chains, [['search_nearby']]);
});

void test('the multi selections still accept only the empty chain — their stage says so', () => {
  const multi = [
    'D3_multi_success_two',
    'D3_multi_success_single',
    'D3_multi_terminal_empty',
    'D3_multi_partial_success',
  ];

  for (const name of multi) {
    assert.deepEqual(acceptedChainsForCase(expectationOf(name)), [[]]);
  }
});

void test('every one of the five is measured against at least one step', () => {
  const minima = DATASET.cases.map((entry) =>
    Math.min(...acceptableMinSteps(entry.inputs, entry.metadata, REFUSAL)),
  );

  assert.equal(DATASET.cases.length, 5);
  assert.ok(minima.every((minimum) => minimum > 0));
});
