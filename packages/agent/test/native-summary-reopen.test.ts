import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOrThrow, type AgentMessage } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { JsonlSessionRepo, value, type Session } from "@earendil-works/pi-agent-core/harness/session";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { createCatalogClient } from "@animichi/agent/tools";

const longResult = { outcome: "needs_disambiguation", reason: "anime_ambiguity", candidates: [
  { bangumi_id: "2", title: "A long catalog title ".repeat(12) }, { bangumi_id: "1", title: "Second title" },
] };
const shortResult = { outcome: "not_found", reason: "anime_not_found" };
const frozen = '[resolve_anime: ambiguous, ordered_candidates=["2","1"]]';
const preference = value<string>("animichi", "test-preference");

async function compose(session: Session, responses: FauxResponseStep[]) {
  const provider = fauxProvider();
  provider.setResponses(responses);
  const models = createModels();
  models.setProvider(provider.provider);
  const results = [longResult, shortResult];
  return createPilgrimageHarness({ session, models, model: provider.getModel(), toolContext: {
    session, branch: "main", locale: "en", catalog: createCatalogClient(() => Promise.resolve(Response.json(results.shift()))),
    assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve(),
  } }, context);
}

async function populate(session: Session) {
  const { harness } = await compose(session, [
    fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Retained title" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Missing title" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Done."),
  ]);
  getOrThrow(await (await harness.lane("main", context)).prompt("Find both titles", undefined, context));
  await session.setValue(preference, "native scalar", context);
  const entries = await session.findEntries(undefined, context);
  await harness.close(context);
  return entries;
}

async function assertRestored(session: Session) {
  const requests: AgentMessage[][] = [];
  const { harness } = await compose(session, [(request) => { requests.push(request.messages); return fauxAssistantMessage("Still known."); }]);
  let summaryCalls = 0;
  harness.hooks.on("after_tool", () => { summaryCalls += 1; return { details: { frozenSummary: "Changed summarizer" } }; });
  try {
    getOrThrow(await (await harness.lane("main", context)).prompt("Continue", undefined, context));
    const tools = requests.flat().filter((message) => message.role === "toolResult");
    assert.deepEqual(tools.map((message) => message.content), [[{ type: "text", text: frozen }], [{ type: "text", text: JSON.stringify(shortResult) }]]);
    assert.equal(summaryCalls, 0);
    assert.match(JSON.stringify(requests), /Retained title/);
    assert.equal((await session.getValue(preference, context))?.value, "native scalar");
  } finally { await harness.close(context); }
}

void test("native JSONL reopen uses the persisted summary and leaves an unannotated entry verbatim", async () => {
  const directory = await mkdtemp(join(tmpdir(), "animichi-frozen-reopen-"));
  const fileSystem = new NodeExecutionEnv({ cwd: directory });
  const repo = new JsonlSessionRepo({ fileSystem, sessionsRoot: directory, now: () => 0 });
  const session = await repo.create({ cwd: directory }, context);
  const before = await populate(session);
  await repo.close(context);
  const reopenedRepo = new JsonlSessionRepo({ fileSystem, sessionsRoot: directory, now: () => 0 });
  try {
    const reopened = await reopenedRepo.open(session.metadata, context);
    assert.deepEqual(await reopened.findEntries(undefined, context), before);
    await assertRestored(reopened);
  } finally { await reopenedRepo.close(context); await rm(directory, { recursive: true, force: true }); }
});

void test("native tree fork carries original entries, frozen summaries, executed facts and scalar values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "animichi-frozen-fork-"));
  const repo = new JsonlSessionRepo({ fileSystem: new NodeExecutionEnv({ cwd: directory }), sessionsRoot: directory, now: () => 0 });
  try {
    const session = await repo.create({ cwd: directory }, context);
    const before = await populate(session);
    const fork = await repo.fork(session.metadata, { scope: "tree" }, context);
    assert.deepEqual(await fork.findEntries(undefined, context), before);
    await assertRestored(fork);
  } finally { await repo.close(context); await rm(directory, { recursive: true, force: true }); }
});
