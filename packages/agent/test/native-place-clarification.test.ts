import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { respond, searchNearby, resolveAnime, projectPilgrimage } from "@animichi/agent/tools";
import { fixture, harnessFor } from "./native-tool-fixture.ts";

void test("a composed place clarification keeps radius internally and emits only public candidate fields", async () => {
  const candidates = [
    { id: "tokyo", label: "Tokyo", name: "Tokyo", lat: 35, lng: 139, kind: "city", source: "seed", effective_radius_m: 1200 },
    { id: "tokyo-2", label: "Other Tokyo", name: "Tokyo", lat: 36, lng: 138, kind: "city", source: "seed", effective_radius_m: 2400 },
  ];
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json({ candidates })));
  const { harness } = await harnessFor(toolContext, [
    fauxAssistantMessage(fauxToolCall("search_nearby", { location: "Tokyo" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("respond", { kind: "clarify", reason: "place_ambiguity", message: "Which Tokyo?" }), { stopReason: "toolUse" }),
  ], [searchNearby, respond]);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Find Tokyo", undefined, BACKGROUND_CONTEXT);
  const entries = await session.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  const entry = entries.find((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "respond");
  assert.ok(entry?.type === "message" && entry.message.role === "toolResult");
  assert.equal(entry.message.isError, false);
  assert.equal(entry.terminate, true);
  const pending = projectPilgrimage(entries).clarification;
  assert.ok(pending);
  assert.deepEqual(pending.candidates.map((candidate) => candidate.effective_radius_m), [1200, 2400]);
  assert.deepEqual(entry.message.details, { intent: "clarify", message: "Which Tokyo?", data: { reason: "place_ambiguity", clarification_id: pending.id,
    candidates: [{ id: "tokyo", title: "Tokyo", lat: 35, lng: 139 }, { id: "tokyo-2", title: "Other Tokyo", lat: 36, lng: 138 }] } });
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("a composed anime clarification preserves public cover and point-count metadata", async () => {
  const candidates = [
    { bangumi_id: "1", title: "First", cover_url: "https://example.com/cover", points_count: 0 },
    { bangumi_id: "2", title: "Second", points_count: 4 },
  ];
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json({ outcome: "needs_disambiguation", reason: "anime_ambiguity", candidates })));
  const { harness } = await harnessFor(toolContext, [
    fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Title" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("respond", { kind: "clarify", reason: "anime_ambiguity", message: "Which title?" }), { stopReason: "toolUse" }),
  ], [resolveAnime, respond]);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Find a title", undefined, BACKGROUND_CONTEXT);
  const entries = await session.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  const entry = entries.find((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "respond");
  assert.ok(entry?.type === "message" && entry.message.role === "toolResult");
  assert.equal(entry.message.isError, false);
  assert.equal(entry.terminate, true);
  assert.deepEqual(entry.message.details, { intent: "clarify", message: "Which title?", data: { reason: "anime_ambiguity", clarification_id: projectPilgrimage(entries).clarification?.id,
    candidates: [{ id: "1", title: "First", cover_url: "https://example.com/cover", points_count: 0 }, { id: "2", title: "Second", points_count: 4 }] } });
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});
