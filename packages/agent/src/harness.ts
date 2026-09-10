import { SELECTION_ENTRY, selectionEntryProjector } from "./selection-entry.ts";
import { AgentHarness, type AgentHarnessOptions } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { planRoute, resolveAnime, respond, searchBangumi, searchNearby, translateAnimeTitle, webSearch, type PilgrimageToolContext } from "./tools.ts";
import { installContextHooks } from "./native-context-hooks.ts";

/** Shared production/eval composition. The caller retains the SDK's native lifecycle and hooks. */
export async function createPilgrimageHarness(options: Omit<AgentHarnessOptions<PilgrimageToolContext>, "tools">, context: Context) {
  const created = await AgentHarness.create({ ...options, entryProjectors: { ...options.entryProjectors, [SELECTION_ENTRY]: selectionEntryProjector }, tools: [resolveAnime, searchBangumi, searchNearby, planRoute, translateAnimeTitle, webSearch, respond] }, context);
  installContextHooks(created.harness, options.session);
  return created;
}
