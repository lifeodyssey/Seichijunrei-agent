import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { respond, searchBangumi, searchNearby, projectPilgrimage } from "@animichi/agent/tools";
import { fixture, harnessFor } from "./native-tool-fixture.ts";

const point = { id: "1", name: "Station", bangumi_id: "1", screenshot_url: "https://image.anitabi.cn/a.jpg", latitude: 35, longitude: 139, city: "Uji" };

for (const scenario of [{ name: "search_nearby", args: {}, tools: [searchNearby, respond] }, { name: "search_bangumi", args: { bangumi_id: "1" }, tools: [searchBangumi, respond] }]) {
  void test(`a ${scenario.name} response preserves actual points and localized display data`, async () => {
    const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json({ rows: [point], synced_at: "today", partial: false })));
    toolContext.origin = { lat: 35, lng: 139 };
    toolContext.locale = "ja";
    const { harness } = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall(scenario.name, scenario.args), { stopReason: "toolUse" }), fauxAssistantMessage(fauxToolCall("respond", { kind: "search", message: "Found a station" }), { stopReason: "toolUse" })], scenario.tools);
    await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Find", undefined, BACKGROUND_CONTEXT);
    const entries = await session.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
    const answer = entries.find((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "respond");
    assert.ok(answer?.type === "message" && answer.message.role === "toolResult");
    assert.equal(answer.message.isError, false);
    assert.match(JSON.stringify(answer.message.details), /宇治/);
    assert.match(JSON.stringify(answer.message.details), /img\/a.jpg/);
    assert.equal(projectPilgrimage(entries).clarification, undefined);
    await harness.close(BACKGROUND_CONTEXT);
    await repo.close(BACKGROUND_CONTEXT);
  });
}
