import type { HookInvocation } from "@earendil-works/pi-agent-core";
import { RouteDetails } from "./pilgrimage-projection.ts";
import { ExecutedFacts } from "./tool-context-annotations.ts";
import { trustedText } from "./trusted-text.ts";

const ENTITY_ARGUMENT: Readonly<Record<string, string>> = { resolve_anime: "title", search_nearby: "location" };

/** These facts come from native after_tool effective arguments and its successful result. */
export function executedToolFacts(event: HookInvocation<"after_tool">, hasSummary: boolean) {
  const pacing = executedPacing(event);
  const field = ENTITY_ARGUMENT[event.toolName];
  const value = field ? event.args[field] : undefined;
  const retainedEntity = hasSummary && typeof value === "string" ? trustedText(value, 96) : "";
  if (!pacing && !retainedEntity) return undefined;
  return { ...(pacing ? { pacing } : {}), ...(retainedEntity ? { retainedEntity } : {}) };
}

function executedPacing(event: HookInvocation<"after_tool">) {
  if (event.toolName !== "plan_route" || event.isError) return undefined;
  const route = RouteDetails.safeParse(event.details);
  if (!route.success || !route.data.itinerary.point_count) return undefined;
  const pacing = ExecutedFacts.shape.pacing.safeParse(event.args.pacing);
  return pacing.success ? pacing.data : undefined;
}
