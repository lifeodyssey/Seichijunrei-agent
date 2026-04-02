import type { ConversationRecord } from "./types";

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sortConversationRecords(
  records: ConversationRecord[],
): ConversationRecord[] {
  return [...records].sort(
    (left, right) => timestamp(right.updated_at) - timestamp(left.updated_at),
  );
}

export function getConversationDisplayTitle(
  record: ConversationRecord,
): string {
  return record.title?.trim() || record.first_query;
}

export function upsertConversationRecord(
  records: ConversationRecord[],
  sessionId: string,
  firstQuery: string,
  now: string = new Date().toISOString(),
): ConversationRecord[] {
  const existing = records.find((record) => record.session_id === sessionId);
  if (existing) {
    return sortConversationRecords(
      records.map((record) =>
        record.session_id === sessionId
          ? { ...record, updated_at: now }
          : record,
      ),
    );
  }

  return sortConversationRecords([
    {
      session_id: sessionId,
      title: null,
      first_query: firstQuery,
      created_at: now,
      updated_at: now,
    },
    ...records,
  ]);
}

export function renameConversationRecord(
  records: ConversationRecord[],
  sessionId: string,
  title: string,
  now: string = new Date().toISOString(),
): ConversationRecord[] {
  return sortConversationRecords(
    records.map((record) =>
      record.session_id === sessionId
        ? {
            ...record,
            title,
            updated_at: now,
          }
        : record,
    ),
  );
}

export function mergeConversationLists(
  optimisticRecords: ConversationRecord[],
  fetchedRecords: ConversationRecord[],
): ConversationRecord[] {
  const bySessionId = new Map(
    fetchedRecords.map((record) => [record.session_id, record]),
  );

  optimisticRecords.forEach((record) => {
    if (!bySessionId.has(record.session_id)) {
      bySessionId.set(record.session_id, record);
    }
  });

  return sortConversationRecords([...bySessionId.values()]);
}
