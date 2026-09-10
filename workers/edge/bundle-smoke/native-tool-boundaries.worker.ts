import { createPilgrimageHarness } from "@animichi/agent/harness";
import { createCatalogClient } from "@animichi/agent/tools";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";

export default { async fetch(request: Request) {
  const invalidInput = new URL(request.url).pathname === "/invalid-input";
  let calls = 0;
  const repo = new MemorySessionRepo();
  const session = await repo.create({}, context);
  const provider = fauxProvider();
  provider.setResponses([fauxAssistantMessage(fauxToolCall("resolve_anime", { title: invalidInput ? " " : "Your Name" }), { stopReason: "toolUse" }), fauxAssistantMessage("Done")]);
  const models = createModels(); models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, models, model: provider.getModel(),
    toolContext: { session, branch: "main", locale: "en", assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve(),
      catalog: createCatalogClient(() => { calls += 1; return Promise.resolve(Response.json({ outcome: "resolved", match: {} })); }) } }, context);
  await (await harness.lane("main", context)).prompt("Resolve", undefined, context);
  const entries = await session.findEntries(undefined, context);
  const result = entries.find((entry) => entry.type === "message" && entry.message.role === "toolResult");
  const rejected = result?.type === "message" && result.message.role === "toolResult" && result.message.isError;
  await harness.close(context); await repo.close(context);
  return Response.json({ rejected, calls, diagnostic: result });
} };
