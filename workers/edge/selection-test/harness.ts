import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { NeonSessionRepo } from "@animichi/pi-session-neon";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { createCatalogClient, type PilgrimageToolContext } from "@animichi/agent/tools";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import { database, SESSION_ID, IDENTITY } from "./postgres.ts";

export async function attach(session: Session, fetch: (request: Request) => Promise<Response>) {
  const models = createModels(), provider = fauxProvider();
  models.setProvider(provider.provider);
  const toolContext: PilgrimageToolContext = { session, branch: "main", locale: "en", catalog: createCatalogClient(fetch),
    assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve() };
  const { harness } = await createPilgrimageHarness({ session, toolContext, models, model: provider.getModel() }, BACKGROUND_CONTEXT);
  return { harness, lane: await harness.lane("main", BACKGROUND_CONTEXT), catalog: toolContext.catalog, provider };
}

export async function fixture() {
  const repo = new NeonSessionRepo(database), session = await repo.create({ id: SESSION_ID }, BACKGROUND_CONTEXT);
  const calls: Request[] = [];
  const fetch = (request: Request) => { calls.push(request); return Promise.resolve(Response.json({ rows: [] })); };
  const attached = await attach(session, fetch);
  const id = await attached.lane.appendMessage({ role: "toolResult", toolCallId: "offer", toolName: "search_nearby", timestamp: 0,
    isError: false, content: [], details: { reason: "place_ambiguity", candidates: [{ id: "station", title: "Station", lat: 35, lng: 139 }] } }, BACKGROUND_CONTEXT);
  const entry = await session.getEntry(id, BACKGROUND_CONTEXT);
  const request = { sessionId: SESSION_ID, identityId: IDENTITY, payer: "anon" as const, clientMessageId: "pick-1",
    selection: { of: "candidates" as const, candidateIds: ["station"], clarificationId: entry?.seq ?? -1, locale: "en" } };
  return { repo, session, calls, fetch, request, ...attached };
}
