import assert from "node:assert/strict";
import test from "node:test";
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

test("getConversationDisplayTitle falls back to the first query", () => {
  assert.equal(
    getConversationDisplayTitle({
      ...EXISTING_RECORD,
      title: null,
    }),
    EXISTING_RECORD.first_query,
  );
});

test("upsertConversationRecord inserts a new conversation at the top", () => {
  const nextRecords = upsertConversationRecord(
    [EXISTING_RECORD],
    "sess-new",
    "京都駅から回りたい",
    "2026-04-02T08:00:00.000Z",
  );

  assert.equal(nextRecords[0]?.session_id, "sess-new");
  assert.equal(nextRecords[0]?.first_query, "京都駅から回りたい");
  assert.equal(nextRecords[0]?.title, null);
  assert.equal(nextRecords[1]?.session_id, "sess-existing");
});

test("upsertConversationRecord refreshes an existing conversation without overwriting its title", () => {
  const nextRecords = upsertConversationRecord(
    [EXISTING_RECORD],
    "sess-existing",
    "別の質問",
    "2026-04-02T09:30:00.000Z",
  );

  assert.deepEqual(nextRecords, [
    {
      ...EXISTING_RECORD,
      updated_at: "2026-04-02T09:30:00.000Z",
    },
  ]);
});

test("renameConversationRecord updates the title and bumps recency", () => {
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

  assert.equal(nextRecords[0]?.session_id, "sess-older");
  assert.equal(nextRecords[0]?.title, "新タイトル");
  assert.equal(nextRecords[0]?.updated_at, "2026-04-03T00:00:00.000Z");
});

test("mergeConversationLists keeps optimistic local rows while preferring fetched duplicates", () => {
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

  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], fetched[0]);
  assert.equal(merged[1]?.session_id, "sess-local");
});
