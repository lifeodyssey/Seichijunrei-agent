import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { executeSelection, SELECTION_ENTRY, selectionEntryData } from "@animichi/agent/selection";
import { createCatalogClient, readSearchResult } from "@animichi/agent/tools";
import { POINT_A, selectionFixture } from "./native-selection-fixture.ts";

void test("a partial selected work cannot become a routeable result reference", async () => {
  const { repo, session, branch, entries, revision } = await selectionFixture("resolve_anime", { outcome: "needs_disambiguation", reason: "anime_ambiguity",
    candidates: [{ bangumi_id: "123", title: "First" }, { bangumi_id: "456", title: "Second" }] });
  const catalog = createCatalogClient(() => Promise.resolve(Response.json({ rows: [POINT_A], partial: true, synced_at: "2026-09-10" })));
  const result = await executeSelection({ of: "candidates", candidateIds: ["123"], clarificationId: revision, locale: "en" }, entries, catalog, context);
  assert.equal(result.status, "partial");
  const ref = await branch.appendCustomEntry(SELECTION_ENTRY, selectionEntryData("partial-selection", result), context);
  assert.equal(await readSearchResult(session, "main", ref, context), undefined);
  await repo.close(context);
});

void test("a native selection reference cannot cross a branch or be inferred from another custom entry type", async () => {
  const { repo, session, branch, entries, revision } = await selectionFixture("search_nearby", { reason: "place_ambiguity",
    candidates: [{ id: "station", title: "Station", lat: 35, lng: 139 }] });
  const catalog = createCatalogClient(() => Promise.resolve(Response.json({ rows: [POINT_A] })));
  const result = await executeSelection({ of: "candidates", candidateIds: ["station"], clarificationId: revision, locale: "en" }, entries, catalog, context);
  const other = await session.createBranch("other", null, context);
  const foreignRef = await other.appendCustomEntry(SELECTION_ENTRY, selectionEntryData("other-branch", result), context);
  assert.equal(await readSearchResult(session, "main", foreignRef, context), undefined);
  const unrelated = await branch.appendCustomEntry("unrelated.annotation", selectionEntryData("other-kind", result), context);
  assert.equal(await readSearchResult(session, "main", unrelated, context), undefined);
  await repo.close(context);
});
