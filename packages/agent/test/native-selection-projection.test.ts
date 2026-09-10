import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { executeSelection, SELECTION_ENTRY, selectionEntryData, readSelectionEntry } from "@animichi/agent/selection";
import { createCatalogClient, projectPilgrimage } from "@animichi/agent/tools";
import { selectionFixture } from "./native-selection-fixture.ts";

const OFFER = { reason: "place_ambiguity", candidates: [{ id: "station", title: "Station", lat: 35, lng: 139 }] };
const catalog = createCatalogClient(() => Promise.resolve(Response.json({ rows: [] })));

void test("one correlated custom result consumes its matching clarification without a second state write", async () => {
  const { repo, branch, entries, revision } = await selectionFixture("search_nearby", OFFER);
  const result = await executeSelection({ of: "candidates", candidateIds: ["station"], clarificationId: revision, locale: "en" }, entries, catalog, BACKGROUND_CONTEXT);
  const id = await branch.appendCustomEntry(SELECTION_ENTRY, selectionEntryData("pick-1", result), BACKGROUND_CONTEXT);
  const committed = await branch.findEntries(undefined, BACKGROUND_CONTEXT);
  assert.equal(committed.length, 2);
  const selection = committed.find((entry) => entry.id === id);
  assert.ok(selection);
  assert.equal(readSelectionEntry(selection)?.origin, "server");
  assert.equal(readSelectionEntry(selection)?.requestKey, "pick-1");
  assert.equal(projectPilgrimage(committed).clarification, undefined);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("an older successful selection cannot clear a newer native clarification", async () => {
  const { repo, branch, entries, revision } = await selectionFixture("search_nearby", OFFER);
  const result = await executeSelection({ of: "candidates", candidateIds: ["station"], clarificationId: revision, locale: "en" }, entries, catalog, BACKGROUND_CONTEXT);
  const newer = await branch.appendMessage({ role: "toolResult", toolCallId: "new", toolName: "search_nearby", timestamp: 0, content: [], isError: false,
    details: { reason: "place_ambiguity", candidates: [{ id: "new-place", title: "New place", lat: 36, lng: 140 }] } }, BACKGROUND_CONTEXT);
  await branch.appendCustomEntry(SELECTION_ENTRY, selectionEntryData("old-pick", result), BACKGROUND_CONTEXT);
  assert.equal(projectPilgrimage(await branch.findEntries(undefined, BACKGROUND_CONTEXT)).clarification?.entryId, newer);
  await repo.close(BACKGROUND_CONTEXT);
});
