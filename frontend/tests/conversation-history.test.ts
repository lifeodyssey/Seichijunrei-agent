import { it, expect } from "vitest";
import type { ConversationRecord } from "../lib/types";
import {
  getConversationDisplayTitle,
  mergeConversationLists,
  renameConversationRecord,
  upsertConversationRecord,
} from "../lib/conversation-history";

const EXISTING_RECORD: ConversationRecord = {
  session_id: "sess-existing",
  title: "宇治巡礼",
  first_query: "宇治の聖地を探して",
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-01T12:00:00.000Z",
};

it("getConversationDisplayTitle falls back to the first query", () => {
  expect(
    getConversationDisplayTitle({
      ...EXISTING_RECORD,
      title: null,
    }),
  ).toBe(EXISTING_RECORD.first_query);
});

it("upsertConversationRecord inserts a new conversation at the top", () => {
  const nextRecords = upsertConversationRecord(
    [EXISTING_RECORD],
    "sess-new",
    "京都駅から回りたい",
    "2026-04-02T08:00:00.000Z",
  );

  expect(nextRecords[0]?.session_id).toBe("sess-new");
  expect(nextRecords[0]?.first_query).toBe("京都駅から回りたい");
  expect(nextRecords[0]?.title).toBe(null);
  expect(nextRecords[1]?.session_id).toBe("sess-existing");
});

it("upsertConversationRecord refreshes an existing conversation without overwriting its title", () => {
  const nextRecords = upsertConversationRecord(
    [EXISTING_RECORD],
    "sess-existing",
    "別の質問",
    "2026-04-02T09:30:00.000Z",
  );

  expect(nextRecords).toEqual([
    {
      ...EXISTING_RECORD,
      updated_at: "2026-04-02T09:30:00.000Z",
    },
  ]);
});

it("renameConversationRecord updates the title and bumps recency", () => {
  const olderRecord: ConversationRecord = {
    session_id: "sess-older",
    title: "旧タイトル",
    first_query: "旧クエリ",
    created_at: "2026-03-31T00:00:00.000Z",
    updated_at: "2026-03-31T01:00:00.000Z",
  };

  const nextRecords = renameConversationRecord(
    [olderRecord, EXISTING_RECORD],
    "sess-older",
    "新タイトル",
    "2026-04-03T00:00:00.000Z",
  );

  expect(nextRecords[0]?.session_id).toBe("sess-older");
  expect(nextRecords[0]?.title).toBe("新タイトル");
  expect(nextRecords[0]?.updated_at).toBe("2026-04-03T00:00:00.000Z");
});

it("mergeConversationLists keeps optimistic local rows while preferring fetched duplicates", () => {
  const fetched: ConversationRecord[] = [
    {
      ...EXISTING_RECORD,
      title: "サーバー側タイトル",
      updated_at: "2026-04-04T00:00:00.000Z",
    },
  ];
  const optimistic: ConversationRecord[] = [
    EXISTING_RECORD,
    {
      session_id: "sess-local",
      title: null,
      first_query: "ローカルだけの会話",
      created_at: "2026-04-02T00:00:00.000Z",
      updated_at: "2026-04-02T00:00:00.000Z",
    },
  ];

  const merged = mergeConversationLists(optimistic, fetched);

  expect(merged.length).toBe(2);
  expect(merged[0]).toEqual(fetched[0]);
  expect(merged[1]?.session_id).toBe("sess-local");
});
