import { ExecutionWitness } from "./execution-witness.ts";
import { Point } from "@animichi/contract/models";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Entry, Session } from "@earendil-works/pi-agent-core/harness/session";
import { z } from "zod";
import { proxyScreenshots } from "./anitabi-image-proxy.ts";
import { localizedCityName } from "./localized-city-name.ts";
import { readSelectionEntry } from "./selection-entry.ts";
import { FrozenSummary, ExecutedFacts } from "./tool-context-annotations.ts";

export const SearchResultDetails = z.object({
  execution: ExecutionWitness.optional(),
  kind: z.enum(["bangumi", "nearby"]), anime_id: z.string().nullable(),
  rows: z.array(Point), partial: z.boolean(),
  frozenSummary: FrozenSummary.optional(), executedFacts: ExecutedFacts.optional(),
}).strict();

/** A ref only names a committed result in the current branch, including shared fork ancestry. */
export async function readSearchResult(session: Session, branchName: string, ref: string, context: Context) {
  const entry = await session.getEntry(ref, context);
  const branch = await session.branch(branchName, context);
  if (!entry || !branch || !(await branch.findEntries(undefined, context)).some((item) => item.id === ref)) return undefined;
  if (entry.type === "custom") return selectedPoints(entry);
  if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.isError) return undefined;
  if (!["search_bangumi", "search_nearby"].includes(entry.message.toolName)) return undefined;
  const parsed = SearchResultDetails.safeParse(entry.message.details);
  return parsed.success ? parsed.data : undefined;
}

function selectedPoints(entry: Entry) {
  const result = readSelectionEntry(entry)?.result;
  if (result?.status !== "ok") return undefined;
  return { rows: result.itinerary?.ordered_points ?? result.rows, partial: false };
}

export function displayPoints(points: Point[], locale: string): Point[] {
  return proxyScreenshots(points).map((point) => point.city
    ? { ...point, city: localizedCityName(point.city, locale) } : point);
}
