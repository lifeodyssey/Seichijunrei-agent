import { ChatResponseDataPart } from "@animichi/contract";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import type { Entry } from "@earendil-works/pi-agent-core/harness/session";
import { Type, type Static } from "typebox";
import { authorizeInvocation, type PilgrimageToolContext } from "./tool-context.ts";
import { projectPilgrimage, RouteDetails } from "./pilgrimage-projection.ts";
import { SearchResultDetails } from "./search-result.ts";

const parameters = Type.Object({ kind: Type.Union([Type.Literal("search"), Type.Literal("route"), Type.Literal("clarify"), Type.Literal("greeting"), Type.Literal("qa")]),
  message: Type.String({ pattern: "\\S" }), reason: Type.Optional(Type.String({ pattern: "\\S" })) }, { additionalProperties: false });

/** Response validation is pure and replay-safe; only valid public data carries native termination. */
export const respond: AgentHarnessTool<PilgrimageToolContext, typeof parameters, ChatResponseDataPart> = {
  name: "respond", label: "Answer the user", replay: "safe", parameters,
  description: "Submit a response after domain work. Search and route require current-turn evidence; clarification must use the offered reason.",
  async execute(_id, params, _update, tools, invocation, context) {
    await authorizeInvocation(tools, invocation, context);
    const branch = await tools.session.branch(tools.branch, context);
    const entries = await branch?.findEntries(undefined, context) ?? [];
    const details = ChatResponseDataPart.parse(answer(params, entries));
    return { content: [{ type: "text", text: params.message }], details, terminate: true };
  },
};

function answer(params: Static<typeof parameters>, entries: Entry[]) {
  if (params.kind === "clarify") return clarify(params, entries);
  if (params.kind === "route") return route(params.message, currentTurn(entries));
  if (params.kind === "search") return search(params.message, currentTurn(entries));
  return { intent: params.kind === "qa" ? "general_qa" : "greet_user", message: params.message, data: {} };
}

function currentTurn(entries: Entry[]) {
  const ordered = [...entries].sort((left, right) => right.seq - left.seq);
  const user = ordered.findIndex((entry) => entry.type === "message" && entry.message.role === "user");
  return user < 0 ? ordered : ordered.slice(0, user);
}

function search(message: string, entries: Entry[]) {
  const latest = entries.find((entry) => isToolResult(entry, ["search_bangumi", "search_nearby"]));
  const result = SearchResultDetails.safeParse(latest?.type === "message" && latest.message.role === "toolResult" ? latest.message.details : undefined);
  if (!result.success) throw new Error("search requires a successful search result in this turn");
  return { intent: result.data.kind === "nearby" ? "search_nearby" : "search_bangumi", message,
    data: { results: { kind: result.data.kind, rows: result.data.rows, row_count: result.data.rows.length } } };
}

function route(message: string, entries: Entry[]) {
  const latest = entries.find((entry) => isToolResult(entry, ["plan_route"]));
  const result = RouteDetails.safeParse(latest?.type === "message" && latest.message.role === "toolResult" ? latest.message.details : undefined);
  if (!result.success) throw new Error("route requires a successful route result in this turn");
  return { intent: "plan_route", message, data: { itinerary: result.data.itinerary } };
}

function clarify(params: Static<typeof parameters>, entries: Entry[]) {
  const pending = projectPilgrimage(entries).clarification;
  if (!pending || pending.reason !== params.reason) throw new Error("clarify must match the pending clarification reason");
  return { intent: "clarify", message: params.message,
    data: { reason: pending.reason, clarification_id: pending.id, candidates: pending.candidates.map(publicCandidate) } };
}

function publicCandidate({ id, title, cover_url, points_count, lat, lng }: NonNullable<ReturnType<typeof projectPilgrimage>["clarification"]>["candidates"][number]) {
  return { id, title, ...(cover_url !== undefined ? { cover_url } : {}), ...(points_count !== undefined ? { points_count } : {}),
    ...(lat !== undefined ? { lat } : {}), ...(lng !== undefined ? { lng } : {}) };
}

function isToolResult(entry: Entry, names: string[]): boolean {
  return entry.type === "message" && entry.message.role === "toolResult" && !entry.message.isError && names.includes(entry.message.toolName);
}
