import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Case, Dataset, Evaluator, type EvaluatorContext } from 'logfire/evals';

import { bootstrapGate } from '../src/gate/bootstrap-gate.ts';
import { aggregateScores, gateInputFromReport } from '../src/gate/report-gate-input.ts';
import { oracleEntryNamed, readStatsOracle } from '../src/gate/stats-oracle.ts';

type Scores = Record<string, number>;
interface RunInputs {
  readonly scores: Scores;
}

const real = oracleEntryNamed(readStatsOracle().bootstrap_gates, 'real_baseline_subset');

/** Replays a case's recorded scores, so the report carries the run's metrics. */
class RecordedScores extends Evaluator<RunInputs, Scores, undefined> {
  evaluate(ctx: EvaluatorContext<RunInputs, Scores, undefined>): Scores {
    return ctx.output;
  }
}

/** A boolean evaluator: logfire files it under `assertions`, not `scores`. */
class Answered extends Evaluator<RunInputs, Scores, undefined> {
  evaluate(ctx: EvaluatorContext<RunInputs, Scores, undefined>): boolean {
    return Object.keys(ctx.output).length > 0;
  }
}

function makeCase(name: string, scores: Scores): Case<RunInputs, Scores, undefined> {
  return new Case<RunInputs, Scores, undefined>({ name, inputs: { scores } });
}

function answeringTask(inputs: RunInputs): Scores {
  return inputs.scores;
}

function fallingOverTask(): Scores {
  throw new Error('the task fell over');
}

function runDataset(
  cases: Case<RunInputs, Scores, undefined>[],
  task: (inputs: RunInputs) => Scores = answeringTask,
) {
  const dataset = new Dataset<RunInputs, Scores, undefined>({
    name: 'gate-report-input',
    cases,
    evaluators: [new RecordedScores(), new Answered()],
  });
  return dataset.evaluate(task);
}

function subjectCases(): Case<RunInputs, Scores, undefined>[] {
  return Object.entries(real.current_cases).map(([name, scores]) => makeCase(name, { ...scores }));
}

void test('the run\'s per-case scores are what the gate pairs against', async () => {
  const report = await runDataset(subjectCases());
  const input = gateInputFromReport(report);
  const scored = Object.fromEntries(
    Object.entries(input.cases).map(([name, scores]) => [name, dropAssertion(scores)]),
  );
  assert.deepEqual(scored, real.current_cases);
});

void test('a real committed baseline gates that TS report', async () => {
  const report = await runDataset(subjectCases());
  const outcome = bootstrapGate(gateInputFromReport(report).cases, real.baseline, {
    iterations: real.iterations,
    strata: real.strata,
  });
  assert.deepEqual(outcome.failures, real.failures);
});

void test('a boolean evaluator still reaches the gate, as one and zero', async () => {
  const report = await runDataset([makeCase('a', { metric: 0.5 })]);
  assert.deepEqual(gateInputFromReport(report).cases, { a: { metric: 0.5, Answered: 1 } });
});

void test('an evaluated run counts every case as evaluated', async () => {
  const report = await runDataset([makeCase('a', { metric: 1 }), makeCase('b', { metric: 0 })]);
  const input = gateInputFromReport(report);
  assert.deepEqual(counts(input), { evaluatedCount: 2, erroredCount: 0, total: 2 });
});

void test('errored cases count against the error rate, not the scores', async () => {
  const cases = [makeCase('a', { metric: 1 }), makeCase('b', { metric: 0 })];
  const input = gateInputFromReport(await runDataset(cases, fallingOverTask));
  assert.deepEqual(counts(input), { evaluatedCount: 0, erroredCount: 2, total: 2 });
  assert.deepEqual(input.cases, {});
});

void test('the named averages come back as plain numbers', async () => {
  const report = await runDataset([makeCase('a', { metric: 0.5 }), makeCase('b', { metric: 0.25 })]);
  assert.deepEqual(aggregateScores(report, ['metric']), { metric: 0.375 });
});

void test('a metric the run never produced is named, not silently zero', async () => {
  const report = await runDataset([makeCase('a', { metric: 0.5 })]);
  assert.throws(
    () => aggregateScores(report, ['metric', 'missing']),
    /Missing metric\(s\): missing\. Available: metric/,
  );
});

void test('a run where every case errored has no average to report', async () => {
  const report = await runDataset([makeCase('a', { metric: 1 })], fallingOverTask);
  assert.throws(() => aggregateScores(report, ['metric']), /All cases errored/);
});

function counts(input: { evaluatedCount: number; erroredCount: number; total: number }) {
  return {
    evaluatedCount: input.evaluatedCount,
    erroredCount: input.erroredCount,
    total: input.total,
  };
}

function dropAssertion(scores: Readonly<Scores>): Scores {
  const { Answered: _answered, ...rest } = scores;
  return rest;
}
