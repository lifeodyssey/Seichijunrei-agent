/**
 * The rule `StepEfficiency` applies to a turn with no steps, in its own words (#1439).
 *
 * `evaluator-parity` already scores these branches against Python's numbers,
 * but it catches a change here only as "the record differs from the oracle" —
 * incidental, and silent about which rule broke. The rule is: a zero-step turn
 * has no denominator, so the answer comes from what the case would have
 * accepted. One acceptable ideal of 0 means taking no step IS the ideal and the
 * turn keeps 1.0; every acceptable ideal at least 1 means the turn did not
 * attempt the task, and a metric that measures waste has nothing to say about
 * it — no metric, not a zero.
 *
 * The numbers are still Python's (`fixtures/evaluator-oracle.json`); nothing
 * here derives a score. What it derives is which branch a case lands in.
 *
 * test-type: unit (committed fixture, no network, no clock).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StepEfficiency } from '../src/evaluators/step-efficiency.ts';
import { contextFor, oracleCase } from './evaluator-oracle.ts';

/** `search_nearby`, ideal 1, and the turn published no call at all. */
const REFUSED = oracleCase('place_selection_refused_to_act');
/** `greet_user`, ideal 0, and the turn published no call either. */
const GREETED = oracleCase('greet_user_no_steps');

function scoreOf(entry: typeof REFUSED): Record<string, number> {
  return new StepEfficiency().evaluate(contextFor(entry));
}

void test('a zero-step turn whose every acceptable ideal is at least one is not scored', () => {
  assert.equal(REFUSED.transcript.stepCount, 0);
  assert.deepEqual(scoreOf(REFUSED), {});
});

void test('a zero-step turn is not scored zero either — absence is not a failing score', () => {
  assert.ok(!('step_efficiency' in scoreOf(REFUSED)));
});

void test('a zero-step turn the case accepts a zero ideal for keeps the ceiling', () => {
  assert.equal(GREETED.transcript.stepCount, 0);
  assert.deepEqual(scoreOf(GREETED), { step_efficiency: 1 });
});
