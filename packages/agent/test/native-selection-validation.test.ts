import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { executeSelection, SelectionRefused } from "@animichi/agent/selection";
import { createCatalogClient } from "@animichi/agent/tools";

void test("an expired native clarification is refused before cardinality and makes no catalog call", async () => {
  const repo = new MemorySessionRepo({ now: () => 0 });
  const session = await repo.create({}, BACKGROUND_CONTEXT);
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  await branch.appendMessage({ role: "toolResult", toolCallId: "offer", toolName: "search_nearby", timestamp: 0,
    isError: false, content: [], details: { reason: "place_ambiguity", candidates: [{ id: "station", title: "Station", lat: 35, lng: 139 }] } }, BACKGROUND_CONTEXT);
  const catalog = createCatalogClient(() => Promise.reject(new Error("No catalog access before validation")));
  await assert.rejects(executeSelection({ of: "candidates", candidateIds: ["station", "station"], clarificationId: 999, locale: "en" },
    await branch.findEntries(undefined, BACKGROUND_CONTEXT), catalog, BACKGROUND_CONTEXT),
  (error: unknown) => { assert.ok(error instanceof SelectionRefused); assert.equal(error.status, 409); return error.message === "This choice expired; please try again."; });
  await repo.close(BACKGROUND_CONTEXT);
});

void test("a place selection uses committed offered coordinates and radius without geocoding", async () => {
  const repo = new MemorySessionRepo({ now: () => 0 });
  const session = await repo.create({}, BACKGROUND_CONTEXT);
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  const id = await branch.appendMessage({ role: "toolResult", toolCallId: "offer", toolName: "search_nearby", timestamp: 0,
    isError: false, content: [], details: { reason: "place_ambiguity", candidates: [{ id: "station", title: "Station", lat: 35.2, lng: 139.3, effective_radius_m: 1234 }] } }, BACKGROUND_CONTEXT);
  const entry = await session.getEntry(id, BACKGROUND_CONTEXT);
  assert.ok(entry);
  const requests: Request[] = [];
  const catalog = createCatalogClient((request) => { requests.push(request); return Promise.resolve(Response.json({ rows: [] })); });
  const result = await executeSelection({ of: "candidates", candidateIds: ["station"], clarificationId: entry.seq, locale: "en" },
    await branch.findEntries(undefined, BACKGROUND_CONTEXT), catalog, BACKGROUND_CONTEXT);
  assert.equal(requests.length, 1);
  assert.deepEqual(await requests[0]?.json(), { lat: 35.2, lng: 139.3, radius_m: 1234 });
  assert.deepEqual(result.response, { intent: "search_nearby", success: true, status: "empty", message: "No pilgrimage spots were found near that place.", data: { results: { kind: "nearby", rows: [], row_count: 0 } } });
  await repo.close(BACKGROUND_CONTEXT);
});
