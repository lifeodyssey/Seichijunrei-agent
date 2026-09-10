import { expect, it, vi } from "vitest";
import { withoutSnapshotAssistant } from "../../../src/features/chat/use-conversation-history";
import type { ConversationHistory } from "../../../src/features/chat/use-conversation-history";

const entries = [
  { role: "assistant", content: "Identical text", operationId: "previous" },
  { role: "user", content: "Prompt", operationId: "current" },
  { role: "assistant", content: "Identical text", operationId: "current" },
  { role: "assistant", content: "Deterministic selection" },
];

function history(): ConversationHistory {
  return { status: "success", entries, revision: 10, retry: vi.fn() };
}

it("only replaces the native operation's assistant history and retains its user prompt", () => {
  expect(withoutSnapshotAssistant(history(), "current").entries).toEqual([entries[0], entries[1], entries[3]]);
});

it("keeps all history until a native snapshot identifies its operation", () => {
  const original = history();
  expect(withoutSnapshotAssistant(original, undefined)).toBe(original);
});

it("never removes another operation or an independent deterministic result", () => {
  expect(withoutSnapshotAssistant(history(), "absent").entries).toEqual(entries);
});
