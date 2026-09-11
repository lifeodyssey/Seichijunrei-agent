import { AgentHarness, MemorySessionRepo } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SESSION_ID } from "./postgres.ts";

export const context = BACKGROUND_CONTEXT;

export async function nativeHarness() {
  const repo = new MemorySessionRepo({ now: () => 0 });
  const session = await repo.create({ id: SESSION_ID }, context);
  const provider = fauxProvider();
  provider.setResponses([fauxAssistantMessage("Completed")]);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await AgentHarness.create({ session, models, model: provider.getModel() }, context);
  const lane = await harness.lane("main", context);
  return { repo, session, harness, lane, close: async () => { await harness.close(context); await repo.close(context); } };
}

export async function reattachNative(previous: Awaited<ReturnType<typeof nativeHarness>>) {
  await previous.harness.close(context);
  const session = await previous.repo.open(previous.session.metadata, context);
  const provider = fauxProvider();
  provider.setResponses([fauxAssistantMessage("Recovered")]);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await AgentHarness.create({ session, models, model: provider.getModel() }, context);
  const lane = await harness.lane("main", context);
  return { repo: previous.repo, session, harness, lane,
    close: async () => { await harness.close(context); await previous.repo.close(context); } };
}
