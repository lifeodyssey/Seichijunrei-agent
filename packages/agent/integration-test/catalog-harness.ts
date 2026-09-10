import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { AgentLane } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import type { LatLng } from "@animichi/contract/models";
import { createCatalogClient, type PilgrimageToolContext } from "@animichi/agent/tools";

export async function catalogHarness(context: TestContext, address: URL, origin: LatLng = { lat: 35.002, lng: 139 }, webFetch?: typeof globalThis.fetch) {
  const repo = new MemorySessionRepo({ now: () => 0 }); context.after(() => repo.close(BACKGROUND_CONTEXT));
  const session = await repo.create({}, BACKGROUND_CONTEXT);
  const provider = fauxProvider(); const models = createModels(); models.setProvider(provider.provider);
  const requests: string[] = [];
  const catalog = createCatalogClient((request) => {
    requests.push(new URL(request.url).pathname);
    return fetch(new Request(new URL(new URL(request.url).pathname, address), request));
  });
  const toolContext: PilgrimageToolContext = {
    session, branch: "main", locale: "en", origin, catalog, webFetch,
    assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve(),
  };
  const { harness } = await createPilgrimageHarness({ session, models, model: provider.getModel(), toolContext }, BACKGROUND_CONTEXT);
  context.after(() => harness.close(BACKGROUND_CONTEXT));
  return { repo, session, models, toolContext, harness, provider, requests, lane: await harness.lane("main", BACKGROUND_CONTEXT) };
}

export async function latestTool(lane: AgentLane, name: string) {
  const entries = await lane.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  const entry = entries.toSorted((left, right) => left.seq - right.seq).findLast((item) => item.type === "message" && item.message.role === "toolResult" && item.message.toolName === name);
  assert.ok(entry?.type === "message" && entry.message.role === "toolResult");
  assert.equal(entry.message.isError, false, JSON.stringify(entry.message));
  return { id: entry.id, message: entry.message };
}
