import { AgentHarness } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { createModels, fauxAssistantMessage, fauxToolCall, fauxProvider, type FauxResponseStep } from "@earendil-works/pi-ai";
import assert from "node:assert/strict";
import { createCatalogClient, type PilgrimageToolContext } from "@animichi/agent/tools";

export async function fixture(fetch: (request: Request) => Promise<Response>) {
  const repo = new MemorySessionRepo({ now: () => 0 });
  const session = await repo.create({}, BACKGROUND_CONTEXT);
  const toolContext: PilgrimageToolContext = {
    session, branch: "main", locale: "en", catalog: createCatalogClient(fetch),
    assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve(),
  };
  return { repo, session, toolContext };
}

export async function executeTool(toolContext: PilgrimageToolContext, name: string, args: Parameters<typeof fauxToolCall>[1], tools: Parameters<typeof harnessFor>[2]) {
  const { harness } = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" }), fauxAssistantMessage("Finished.")], tools);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Request", undefined, BACKGROUND_CONTEXT);
  const entries = await toolContext.session.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  await harness.close(BACKGROUND_CONTEXT);
  const entry = [...entries].sort((left, right) => right.seq - left.seq).find((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === name);
  assert.ok(entry?.type === "message" && entry.message.role === "toolResult");
  return { message: entry.message, entries };
}

export async function harnessFor(toolContext: PilgrimageToolContext, responses: FauxResponseStep[], tools: Parameters<typeof AgentHarness.create<PilgrimageToolContext>>[0]["tools"]) {
  const provider = fauxProvider();
  provider.setResponses(responses);
  const models = createModels();
  models.setProvider(provider.provider);
  const created = await AgentHarness.create({ session: toolContext.session, tools, toolContext, models,
    model: provider.getModel(), retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 } }, BACKGROUND_CONTEXT);
  return { ...created, provider };
}
