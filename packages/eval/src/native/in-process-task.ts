import {
  MemorySessionRepo, getOrThrow,
  type AgentLane, type LaneSnapshot, type Session, type Context,
} from '@earendil-works/pi-agent-core';
import { BACKGROUND_CONTEXT, withoutAbortSignal } from '@earendil-works/chord/context';
import { createPilgrimageHarness } from '@animichi/agent/harness';
import { observeAttempt } from './attempt-observations.ts';

type HarnessOptions = Parameters<typeof createPilgrimageHarness>[0];
type Harness = Awaited<ReturnType<typeof createPilgrimageHarness>>['harness'];

/** A Logfire task invocation owns one SDK session; Dataset.evaluate owns repetition. */
export async function inProcessTask(
  prompt: string,
  options: (session: Session, context: Context) => HarnessOptions | Promise<HarnessOptions>,
  context: Context = BACKGROUND_CONTEXT,
  configureHarness?: (harness: Harness, context: Context) => void | Promise<void>,
): Promise<LaneSnapshot> {
  const repo = new MemorySessionRepo();
  try {
    const session = await repo.create({}, context);
    const configuration = { ...await options(session, context), session };
    return await promptSession(prompt, configuration, context, configureHarness);
  } finally {
    await repo.close(withoutAbortSignal(context));
  }
}

async function promptSession(
  prompt: string, options: HarnessOptions, context: Context,
  configureHarness?: (harness: Harness, context: Context) => void | Promise<void>,
) {
  const { harness } = await createPilgrimageHarness(options, context);
  try {
    observeAttempt(harness);
    await configureHarness?.(harness, context);
    return await promptLane(await harness.lane('main', context), prompt, context);
  } finally {
    await harness.close(withoutAbortSignal(context));
  }
}

async function promptLane(lane: AgentLane, prompt: string, context: Context) {
  getOrThrow(await lane.prompt(prompt, undefined, context));
  const watch = await lane.watch(withoutAbortSignal(context));
  watch.unsubscribe();
  return watch.snapshot;
}
