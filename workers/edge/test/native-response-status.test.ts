import assert from "node:assert/strict";
import test from "node:test";
import { ChatResponseDataPart } from "@animichi/contract";
import { executeSelection } from "@animichi/agent/selection";
import { createCatalogClient } from "@animichi/agent/tools";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { POINT_A, selectionFixture } from "../../../packages/agent/test/native-selection-fixture.ts";
import { responseChunks } from "../src/agent/views/public-content.ts";
import { SecretScrub } from "../src/agent/egress/secret-scrub.ts";

void test("a real partial selection retains its native domain status in the validated public response", async () => {
  const { repo, entries, revision } = await selectionFixture("resolve_anime", { outcome: "needs_disambiguation", reason: "anime_ambiguity",
    candidates: [{ bangumi_id: "123", title: "First" }, { bangumi_id: "456", title: "Second" }] });
  const catalog = createCatalogClient(() => Promise.resolve(Response.json({ rows: [POINT_A], partial: true, synced_at: "2026-09-10" })));
  const result = await executeSelection({ of: "candidates", candidateIds: ["123"], clarificationId: revision, locale: "en" }, entries, catalog, context);
  assert.equal(result.status, "partial");
  const chunk = responseChunks(result.response, "session", new SecretScrub()).at(-1);
  assert.equal(chunk?.type, "data-response");
  assert.ok("data" in chunk);
  const parsed = ChatResponseDataPart.parse(chunk.data);
  assert.equal(parsed.status, "partial");
  assert.equal(parsed.session_id, "session");
  await repo.close(context);
});
