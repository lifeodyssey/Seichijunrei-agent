/**
 * The first-error rules (E-4 #1383, spec §十 10.4): three signals, earliest wins,
 * closed vocabulary.
 *
 * Every turn here is built with `makeAttributedTurn`, so exactly one of the
 * signals moves per fixture — except the last two, which are Python's own
 * transcripts out of `fixtures/evaluator-oracle.json`, scored by Python, so the
 * metric each one fails is not this side's opinion. The mutations these pin:
 * take the LAST deviation instead of the first; replace "earliest" with a fixed
 * priority over the sources; drop the errored-step signal; record an unknown
 * category instead of refusing it; place an unsettled call as a missing one.
 *
 * test-type: unit (constructed turns, no network, no clock).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deviationCategory,
  deviationsOf,
  orderedDeviations,
  type Deviation,
} from '../src/gate-run/first-deviation.ts';
import { oracleCase, type OracleCase } from './evaluator-oracle.ts';
import { makeAttributedTurn, PUBLISHED_ROWS, type AttributedTurn } from './make-attributed-turn.ts';

/** A quoted name no source published, so the reply carries one unsourced claim. */
const UNSOURCED_REPLY = '「架空の作品」の聖地です。';

function placedDeviations(turn: AttributedTurn): readonly Deviation[] {
  return orderedDeviations(
    deviationsOf(turn.inputs, turn.metadata, turn.output),
    turn.output.trajectory.length,
  );
}

function placements(turn: AttributedTurn): readonly string[] {
  return placedDeviations(turn).map(
    (one) => `${one.category}@${String(one.step_index ?? `claim:${String(one.claim_index)}`)}`,
  );
}

/**
 * Two errored calls and, because neither settled, the call the chain still
 * wanted. THREE deviations, so taking the last one is a different answer from
 * taking the first — a fixture with one deviation could not tell them apart.
 */
const twoErroredCalls = makeAttributedTurn({
  stages: ['search_nearby'],
  steps: [
    { tool: 'search_nearby', status: 'error' },
    { tool: 'search_nearby', status: 'error' },
  ],
});

void test('the cause is the first deviation and the rest are its consequences', () => {
  assert.deepEqual(placements(twoErroredCalls), ['tool_error@0', 'tool_error@1', 'missing_call@2']);
});

/** Signal 1 earliest: the wrong tool at step 0, then a failure, then a bad claim. */
const divergedFirst = makeAttributedTurn({
  stages: ['search_bangumi'],
  steps: [{ tool: 'search_nearby' }, { tool: 'search_bangumi', status: 'error' }],
  message: UNSOURCED_REPLY,
  data: PUBLISHED_ROWS,
});

void test('a chain divergence at step 0 outranks a later failure and a bad claim', () => {
  assert.deepEqual(placements(divergedFirst), [
    'wrong_tool@0',
    'tool_error@1',
    'reply_unsourced@claim:0',
  ]);
});

/**
 * Signal 2 earliest: the chain was followed until `search_bangumi` failed, so
 * the call the chain wanted is only MISSING because of that failure — and it
 * sits after it. A fixed "chains first" priority would report the consequence.
 */
const erroredFirst = makeAttributedTurn({
  stages: ['search_bangumi'],
  steps: [{ tool: 'resolve_anime' }, { tool: 'search_bangumi', status: 'error' }],
  message: UNSOURCED_REPLY,
  data: PUBLISHED_ROWS,
});

void test('an errored step outranks the chain divergence it caused', () => {
  assert.deepEqual(placements(erroredFirst), [
    'tool_error@1',
    'missing_call@2',
    'reply_unsourced@claim:0',
  ]);
});

/** Signal 3 earliest: the calls were right, the sentence was not — 10.3's case. */
const claimedFirst = makeAttributedTurn({
  stages: ['search_nearby'],
  steps: [{ tool: 'search_nearby', output: { row_count: 1 } }],
  message: UNSOURCED_REPLY,
  data: PUBLISHED_ROWS,
});

void test('a turn that did everything right and said something wrong is attributed to the claim', () => {
  assert.deepEqual(placements(claimedFirst), ['reply_unsourced@claim:0']);
});

/**
 * The one tie the ordering can produce: a call that was never made sits at
 * `trajectory.length`, and so does every claim. The absence is the cause.
 */
const saidWithoutDoing = makeAttributedTurn({
  stages: ['search_nearby'],
  steps: [],
  message: UNSOURCED_REPLY,
  data: PUBLISHED_ROWS,
});

void test('a call nobody made outranks the reply that had nothing to cite', () => {
  assert.deepEqual(placements(saidWithoutDoing), ['missing_call@0', 'reply_unsourced@claim:0']);
});

/** The fixture the errored-step signal is the ONLY thing standing on: the chain
 * matched over the completed calls, and the reply claims nothing. */
const onlyDeviationIsAFailure = makeAttributedTurn({
  stages: ['search_nearby'],
  steps: [{ tool: 'search_nearby' }, { tool: 'search_nearby', status: 'error' }],
});

void test('a failure is a deviation on its own, with no chain or claim to help', () => {
  assert.deepEqual(placements(onlyDeviationIsAFailure), ['tool_error@1']);
});

void test('a turn that matched its chain and claimed nothing has no deviation at all', () => {
  const clean = makeAttributedTurn({ stages: ['search_nearby'], steps: [{ tool: 'search_nearby' }] });

  assert.deepEqual(placements(clean), []);
});

void test('a case with no accepted chain has nothing to diverge from', () => {
  const unconstrained = makeAttributedTurn({ stages: [], steps: [{ tool: 'web_search' }] });

  assert.deepEqual(placements(unconstrained), []);
});

void test('the vocabulary is closed: an unknown category is refused, not recorded', () => {
  assert.throws(() => deviationCategory('hallucination'), /unknown failure category/u);
  assert.equal(deviationCategory('wrong_tool'), 'wrong_tool');
});

void test('the divergence names both tools, so a reader can see what was expected', () => {
  const [cause] = placedDeviations(divergedFirst);

  assert.deepEqual(cause, {
    category: 'wrong_tool',
    locus: 'step',
    step_index: 0,
    claim_index: null,
    tool_name: 'search_nearby',
    expected_tool: 'resolve_anime',
  });
});

/**
 * An oracle transcript, read as a turn.
 *
 * `priorTrajectory` is supplied because the fixture has no such key: Python had
 * no notion of an earlier run's calls, and its exporter writes what Python knew
 * (E-3 added the member to the TS type for §九 9.1). Empty is the true reading
 * of a synthetic single-turn scenario, not a patch over a missing value.
 */
function oracleDeviations(entry: OracleCase): readonly string[] {
  return placements({
    inputs: entry.inputs,
    metadata: entry.metadata,
    output: { ...entry.transcript, priorTrajectory: [] },
  });
}

/**
 * `argument_correctness` is a live column whose failure has a step index, so it
 * needs a category rather than an `unattributed`. Python scores this transcript
 * 0 on that metric and 1.0 on every other, which is what makes it the fixture:
 * without `wrong_arguments` the whole case comes back unplaced.
 */
void test('a call the runtime had to re-argue is placed at that call', () => {
  const entry = oracleCase('settled_params_dropped_an_optional_null');

  assert.equal(entry.scores.argument_correctness, 0);
  assert.deepEqual(oracleDeviations(entry), ['wrong_arguments@0']);
});

/**
 * The unsettled decision, on Python's own transcript for it. `tool_correctness`
 * and `trajectory_match` are 0 because they exclude the call, but the call WAS
 * made — so the chain comparison is suspended rather than reporting
 * `missing_call` about it, and the case has no other signal. Unattributed is the
 * answer; a `missing_call` here would blame the model for the harness's gap.
 */
void test('a call that was made and never settled is not reported as one that was not made', () => {
  const entry = oracleCase('unsettled_call_excluded_from_chain');

  assert.equal(entry.scores.trajectory_match, 0);
  assert.deepEqual(oracleDeviations(entry), []);
});

void test('the sixth category is in the vocabulary and nothing else joined it', () => {
  assert.equal(deviationCategory('wrong_arguments'), 'wrong_arguments');
  assert.throws(() => deviationCategory('wrong_argument'), /unknown failure category/u);
});
