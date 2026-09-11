import { annotateExecution } from "./execution-witness.ts";
import type { AgentHarness } from "@earendil-works/pi-agent-core";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import type { PilgrimageToolContext } from "./tool-context.ts";
import { annotateToolContext, applyFrozenSummaries } from "./frozen-tool-summary.ts";
import { agentStatusMessage } from "./agent-status.ts";

/** Register native hooks once on the concrete production harness. */
export function installContextHooks(harness: AgentHarness<PilgrimageToolContext>, session: Session) {
  harness.hooks.on("after_tool", annotateToolContext);
  harness.hooks.on("after_tool", annotateExecution);
  harness.hooks.on("transform_context", async ({ messages, lane }, context) => {
    const branch = await session.branch(lane, context);
    if (!branch) throw new Error("The native context branch is missing");
    const entries = await branch.findEntries(undefined, context);
    return { messages: [...applyFrozenSummaries(messages), agentStatusMessage(entries)] };
  });
}
