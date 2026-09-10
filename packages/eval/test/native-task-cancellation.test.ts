import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context';
import type { LaneSnapshot, Session } from '@earendil-works/pi-agent-core';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { Case, Dataset } from 'logfire/evals';
import { inProcessTask } from '../src/native/in-process-task.ts';
import { optionsFor } from './native-task-fixture.ts';

void test('cancellation reaches the in-flight native provider and cleanup still runs', async () => {
  const controller = new AbortController();
  const sessions: Session[] = [];
  const entered = Promise.withResolvers<undefined>();
  const dataset = new Dataset<string, LaneSnapshot>({ name: 'Cancellation',
    cases: [new Case({ name: 'request', inputs: 'Hello' })] });
  const pending = dataset.evaluate((prompt) => inProcessTask(prompt, (session) => {
    sessions.push(session);
    return optionsFor(session, [async (_providerContext, options) => {
      const signal = options?.signal;
      assert.ok(signal);
      entered.resolve(undefined);
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve(); }, { once: true });
      });
      assert.equal(signal.aborted, true);
      return fauxAssistantMessage('', { stopReason: 'aborted' });
    }]);
  }, withAbortSignal(controller.signal, BACKGROUND_CONTEXT)), { signal: controller.signal });
  await entered.promise;
  controller.abort(new Error('Evaluation cancelled'));
  const report = await pending;
  assert.equal(report.cases.length, 0);
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0]?.error_message, 'Evaluation cancelled');
  const session = sessions[0];
  assert.ok(session);
  await assert.rejects(session.getStats(BACKGROUND_CONTEXT), /closed/);
});
