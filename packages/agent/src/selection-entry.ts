import type { Entry, EntryProjector } from "@earendil-works/pi-agent-core/harness/session";
import { z } from "zod";
import { SelectionResult } from "./selection-result.ts";

export const SELECTION_ENTRY = "animichi.selection";
export const SelectionEntry = z.object({ requestKey: z.string().min(1), origin: z.literal("server"), result: SelectionResult }).strict();
export type SelectionEntry = z.infer<typeof SelectionEntry>;

export function selectionEntryData(requestKey: string, result: SelectionResult) {
  return z.json().parse(SelectionEntry.parse({ requestKey, origin: "server", result }));
}

export function readSelectionEntry(entry: Entry): SelectionEntry | undefined {
  if (entry.type !== "custom" || entry.customType !== SELECTION_ENTRY) return undefined;
  return SelectionEntry.parse(entry.data);
}

/** Native context projection only; the persisted record remains a server-origin custom entry. */
export const selectionEntryProjector: EntryProjector = (entry) => {
  const selection = readSelectionEntry(entry);
  if (!selection) return undefined;
  return [{ role: "user", timestamp: entry.timestamp, content: [{ type: "text",
    text: `The user's selection was executed by the server without a model call. ${selectionContext(entry.id, selection)}` }] }];
};

function selectionContext(entryId: string, selection: SelectionEntry): string {
  const { request, step, status, rows, itinerary, omitted } = selection.result;
  const projected = { entryId, requestKey: selection.requestKey, request, step, status,
    pointIds: (itinerary?.ordered_points ?? rows).map((point) => point.id), omitted };
  return JSON.stringify(projected).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}
