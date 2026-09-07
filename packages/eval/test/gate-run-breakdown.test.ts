import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runSpendOf, TASK_SECONDS_NOTE } from '../src/gate-run/run-spend.ts';
import { scoreBreakdownOf } from '../src/gate-run/score-breakdown.ts';
import { makeCannedReport } from './canned-report.ts';

/**
 * `nonempty_results` is on three of the four cases on purpose: Python's
 * evaluator returns `{}` for an untagged case, and a group's mean has to be
 * over the cases that carry the metric rather than over the group.
 */
const report = makeCannedReport([
  { name: 'a', intent: 'search_nearby', locale: 'ja', scores: { tool_correctness: 1, nonempty_results: 1 } },
  { name: 'b', intent: 'search_nearby', locale: 'en', scores: { tool_correctness: 0, nonempty_results: 0 } },
  { name: 'c', intent: 'plan_route', locale: 'ja', scores: { tool_correctness: 1, nonempty_results: 1 } },
  { name: 'd', intent: 'clarify', locale: 'zh', scores: { tool_correctness: 0.5 } },
]);

const breakdown = scoreBreakdownOf(report);

void test('the breakdown groups by the intent the turn answered with', () => {
  assert.deepEqual(Object.keys(breakdown.by_intent), ['clarify', 'plan_route', 'search_nearby']);
});

void test('the breakdown groups by the locale the case asked for', () => {
  assert.deepEqual(Object.keys(breakdown.by_locale), ['en', 'ja', 'zh']);
});

void test('a group knows how many cases it holds', () => {
  assert.equal(breakdown.by_intent.search_nearby?.cases, 2);
});

void test("a group's metric is the mean over that group's cases", () => {
  assert.deepEqual(breakdown.by_intent.search_nearby?.scores.tool_correctness, {
    count: 2,
    mean: 0.5,
  });
});

void test('a locale group averages the same cases from the other direction', () => {
  assert.deepEqual(breakdown.by_locale.ja?.scores.tool_correctness, { count: 2, mean: 1 });
});

void test('a metric only some cases carry averages over those cases', () => {
  assert.deepEqual(breakdown.by_locale.ja?.scores.nonempty_results, { count: 2, mean: 1 });
});

void test('a case that never carried the metric contributes no zero', () => {
  assert.deepEqual(Object.keys(breakdown.by_intent.clarify?.scores ?? {}), ['tool_correctness']);
});

void test('an intent nobody answered with is not a group', () => {
  assert.equal(breakdown.by_intent.plan_multi, undefined);
});

const spent = runSpendOf(
  makeCannedReport([
    { name: 'a', scores: {}, seconds: 0.1 },
    { name: 'b', scores: {}, seconds: 0.2, historyTurns: 2 },
  ]),
);

void test('the run counts the chat submissions its cases call for', () => {
  assert.equal(spent.turns_planned, 4);
});

/** The cases here spend 0.1 s and 0.2 s, and the field still refuses to say so:
 * `task_duration` is the whole task call, and `StagingTurnTask` queues on
 * `InFlightTurns` inside it, so on a real run the number is queue wait (#1476).
 * A committed result must not carry a figure that reads as machine time. */
void test('the seconds the task spent are not claimed, and say where to look', () => {
  assert.deepEqual(
    { seconds: spent.task_seconds, note: spent.task_seconds_note },
    { seconds: null, note: TASK_SECONDS_NOTE },
  );
});

void test('a run of nothing spent nothing', () => {
  assert.deepEqual(runSpendOf(makeCannedReport([])), {
    turns_planned: 0,
    task_seconds: null,
    task_seconds_note: TASK_SECONDS_NOTE,
  });
});
