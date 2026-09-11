import { AgentHarness } from "@earendil-works/pi-agent-core";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import { NeonSessionRepo } from "@animichi/pi-session-neon";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { database, NOW, SESSION_ID } from "./postgres.ts";
import { context } from "./harness.ts";

export async function attachPersistent(session: Session) {
  const provider = fauxProvider();
  provider.setResponses([fauxAssistantMessage("Completed after persistence recovery")]);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await AgentHarness.create({ session, models, model: provider.getModel() }, context);
  return { session, harness, lane: await harness.lane("main", context) };
}

export async function openPersistent() {
  const repo = new NeonSessionRepo(database);
  const session = await repo.open({ id: SESSION_ID, createdAt: NOW, storageVersion: 1 }, context);
  return attachPersistent(session);
}
