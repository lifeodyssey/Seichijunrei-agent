// The npm aliases isolate this 0.85.1 spike from the production 0.84.4 runtime.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { AgentHarness, MemorySessionRepo } from "pi-agent-core-smoke";
import { createModels, fauxProvider } from "pi-ai-smoke";

async function attachHarness(repo: MemorySessionRepo) {
  const session = await repo.create({}, BACKGROUND_CONTEXT);
  const provider = fauxProvider();
  const models = createModels();
  models.setProvider(provider.provider);
  return AgentHarness.create({ session, models, model: provider.getModel() }, BACKGROUND_CONTEXT);
}

async function inspectHarness(repo: MemorySessionRepo) {
  const { harness, open } = await attachHarness(repo);
  try {
    return { open, lanes: await harness.lanes(BACKGROUND_CONTEXT) };
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
}

export default {
  async fetch(): Promise<Response> {
    const repo = new MemorySessionRepo({ now: () => 0 });
    try {
      return Response.json(await inspectHarness(repo));
    } finally {
      await repo.close(BACKGROUND_CONTEXT);
    }
  },
};
