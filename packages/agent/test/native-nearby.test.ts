import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { searchNearby, projectPilgrimage } from "@animichi/agent/tools";
import { fixture, harnessFor } from "./native-tool-fixture.ts";

void test("nearby search asks for a missing location without inventing coordinates", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.reject(new Error("No location may reach catalog")));
  const { harness } = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall("search_nearby", {}), { stopReason: "toolUse" }), fauxAssistantMessage("Where?")], [searchNearby]);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Nearby", undefined, BACKGROUND_CONTEXT);
  assert.equal(projectPilgrimage(await session.findEntries(undefined, BACKGROUND_CONTEXT)).clarification?.reason, "missing_location");
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("nearby uses the caller's real origin and explicit radius", async () => {
  const requests: Request[] = [];
  const { repo, toolContext } = await fixture((request) => { requests.push(request); return Promise.resolve(Response.json({ rows: [] })); });
  toolContext.origin = { lat: 35.123, lng: 139.456 };
  const { harness } = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall("search_nearby", { radius_m: 1234 }), { stopReason: "toolUse" }), fauxAssistantMessage("Empty.")], [searchNearby]);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Nearby", undefined, BACKGROUND_CONTEXT);
  assert.equal(requests.length, 1);
  assert.deepEqual(await requests[0]?.json(), { lat: 35.123, lng: 139.456, radius_m: 1234 });
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});
