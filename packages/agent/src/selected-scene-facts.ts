import type { Point } from "@animichi/contract/models";
import type { Entry } from "@earendil-works/pi-agent-core/harness/session";
import { readSelectionEntry } from "./selection-entry.ts";
import { trustedText } from "./trusted-text.ts";

/** The latest successful explicit point selection replaces the bounded scene set. */
export function selectedSceneFacts(entries: readonly Entry[]): string[] {
  let scenes: string[] = [];
  for (const entry of [...entries].sort((left, right) => left.seq - right.seq)) {
    const result = readSelectionEntry(entry)?.result;
    if (result?.step !== "plan_selected" || result.status !== "ok" || !result.itinerary) continue;
    scenes = [...new Map(result.itinerary.ordered_points.flatMap((point) => scene(point))).values()].slice(0, 8);
  }
  return scenes;
}

function scene(point: Point): [string, string][] {
  if (!point.id || point.episode === undefined || !Number.isInteger(point.episode) || point.episode < 0) return [];
  const time = point.time_seconds !== undefined && point.time_seconds >= 0 ? ` @ ${String(point.time_seconds)}s` : "";
  return [[point.id, trustedText(`Episode ${String(point.episode)} — ${point.name || "unnamed scene"}${time}`, 96)]];
}
