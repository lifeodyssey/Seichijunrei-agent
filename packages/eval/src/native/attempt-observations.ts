import type { AgentHarness, HarnessEvent, HookInvocation } from '@earendil-works/pi-agent-core';
import { incrementEvalMetric, setEvalAttribute } from 'logfire/evals';

/** Subscribe before business hooks so the witness keeps the tool's unchanged result. */
export function observeAttempt<TContext extends object | undefined>(harness: AgentHarness<TContext>) {
  const tools: HookInvocation<'after_tool'>[] = [];
  const usage: Extract<HarnessEvent, { type: 'usage' }>[] = [];
  setEvalAttribute('pi.after_tool', tools);
  setEvalAttribute('pi.usage', usage);
  setEvalAttribute('pi.usage.status', 'unmeasured');
  harness.hooks.on('after_tool', (event) => { tools.push(event); return undefined; });
  harness.events.on('usage', (event) => { recordUsage(event, usage); });
}

function recordUsage(
  event: Extract<HarnessEvent, { type: 'usage' }>,
  usage: Extract<HarnessEvent, { type: 'usage' }>[],
) {
  usage.push(event);
  setEvalAttribute('pi.usage.status', 'measured');
  incrementEvalMetric('pi.cost.total', event.row.usage.cost.total);
}
