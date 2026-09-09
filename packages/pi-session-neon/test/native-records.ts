import type { Entry, UsageRow } from "@earendil-works/pi-agent-core/harness/session";
import { z } from "zod";
import { database, SESSION_ID } from "./postgres.ts";

export function entry(id = "entry", seq = 0, parentId: string | null = null): Extract<Entry, { type: "custom" }> {
  return { id, parentId, seq, timestamp: 123, type: "custom", customType: "choice", data: { city: "Kyoto" } };
}

export const USAGE: UsageRow = {
  id: "usage", seq: 1, entryId: "entry", adjustment: false,
  usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
    cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 } },
};

export function insertEntry(record = entry()) {
  return database.orm.public.PiRecord.create({ sessionId: SESSION_ID, id: record.id, seq: record.seq,
    kind: "entry", payload: z.json().parse(JSON.parse(JSON.stringify(record))) });
}

export function insertUsage(record = USAGE) {
  return database.orm.public.PiRecord.create({ sessionId: SESSION_ID, id: record.id, seq: record.seq,
    kind: "usage", payload: z.json().parse(JSON.parse(JSON.stringify(record))) });
}
