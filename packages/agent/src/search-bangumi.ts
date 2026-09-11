import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { authorizeInvocation, type PilgrimageToolContext } from "./tool-context.ts";
import { displayPoints } from "./search-result.ts";

const parameters = Type.Object({ bangumi_id: Type.String({ pattern: "^[0-9]+$" }) }, { additionalProperties: false });

/** Read-only catalog work is safe to replay; quota is reserved by the stable invocation id. */
export const searchBangumi: AgentHarnessTool<PilgrimageToolContext, typeof parameters> = {
  name: "search_bangumi", label: "Search pilgrimage points", replay: "safe",
  description: "Fetch catalog points for a resolved bangumi_id. Use the returned result_ref to plan a route.",
  parameters,
  async execute(_id, params, _update, tools, invocation, context) {
    await authorizeInvocation(tools, invocation, context);
    const result = await tools.catalog.pointsByBangumiId(params, { signal: context.abortSignal });
    const details = { kind: "bangumi", anime_id: params.bangumi_id, rows: displayPoints(result.rows, tools.locale), partial: result.partial ?? false };
    const text = JSON.stringify({ outcome: details.rows.length ? "ok" : "empty", result_ref: invocation.invocationId, row_count: details.rows.length, partial: details.partial });
    return { content: [{ type: "text", text }], details };
  },
};
