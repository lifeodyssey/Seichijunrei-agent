import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Case, Dataset, Evaluator, type EvaluatorContext } from 'logfire/evals';
import type { LaneSnapshot } from '@earendil-works/pi-agent-core';
import { fauxAssistantMessage, type FauxResponseStep } from '@earendil-works/pi-ai';
import { inProcessTask } from '../src/native/in-process-task.ts';
import { optionsFor } from './native-task-fixture.ts';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';

/** SDK integration assertion only; production correctness belongs to #1559. */
class Completed extends Evaluator<string, LaneSnapshot> {
  override evaluate({ output }: EvaluatorContext<string, LaneSnapshot>) {
    return output.lastResult?.status === 'completed' && output.operation === null;
  }
}

async function evaluate(responses: FauxResponseStep[], prompt = 'Hello') {
  const dataset = new Dataset<string, LaneSnapshot>({ name: 'Terminal states',
    cases: [new Case({ name: 'greeting', inputs: prompt })], evaluators: [new Completed()] });
  return dataset.evaluate((input) => inProcessTask(input, (session) => optionsFor(session, responses)),
    { retryTask: { retries: 0 } });
}

void test('a native failed result is an evaluated attempt with a failing assertion', async () => {
  const report = await evaluate([fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'provider unavailable' })]);
  assert.equal(report.failures.length, 0);
  const result = report.cases[0];
  assert.ok(result);
  assert.equal(result.output.lastResult?.status, 'failed');
  assert.equal(result.assertions.Completed?.value, false);
});

void test('a native admission rejection becomes a Logfire task failure', async () => {
  const report = await evaluate([], '');
  assert.equal(report.cases.length, 0);
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0]?.error_message ?? '', /at least one message/i);
});

void test('a native aborted result fails the execution assertion', async () => {
  const dataset = new Dataset<string, LaneSnapshot>({ name: 'Abort request',
    cases: [new Case({ name: 'request', inputs: 'Hello' })], evaluators: [new Completed()] });
  const report = await dataset.evaluate((prompt) => inProcessTask(prompt,
    (session) => optionsFor(session, []), BACKGROUND_CONTEXT, (harness) => {
      harness.hooks.on('before_request', async (event) => {
        const lane = await harness.lane('main', BACKGROUND_CONTEXT);
        await lane.requestAbort(event.runId, BACKGROUND_CONTEXT);
        return undefined;
      });
    }));
  assert.equal(report.failures.length, 0);
  assert.equal(report.cases[0]?.output.lastResult?.status, 'aborted');
  assert.equal(report.cases[0].assertions.Completed?.value, false);
  assert.equal(report.cases[0].attributes['pi.usage.status'], 'unmeasured');
  assert.equal(report.cases[0].metrics['pi.cost.total'], undefined);
});

void test('a native suspended result cannot pass the execution assertion', async () => {
  const report = await evaluate([fauxAssistantMessage('', { stopReason: 'deferred', deferred: {
    provider: 'faux', modelId: 'faux-model', api: 'faux', id: 'pending-result',
  } })]);
  assert.equal(report.failures.length, 0);
  const result = report.cases[0];
  assert.ok(result);
  assert.equal(result.output.lastResult, undefined);
  assert.equal(result.output.operation?.deferred?.handle.id, 'pending-result');
  assert.equal(result.assertions.Completed?.value, false);
});
