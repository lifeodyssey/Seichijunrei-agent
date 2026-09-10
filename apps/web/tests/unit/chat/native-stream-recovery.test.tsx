/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, onTestFinished } from "vitest";
import { http, HttpResponse } from "msw";
import { useChatSession } from "../../../src/features/chat/use-chat-session";
import { server } from "../../msw/node";
import { CHAT_URL } from "../../msw/chat-handlers";
import { completedNativeWatch } from "./_native-watch";
import { useStreamRecovery } from "../../../src/features/chat/use-stream-recovery";

it("captures native session and operation response headers before any silent stream body arrives", async () => {
  server.use(http.post(CHAT_URL, () => new HttpResponse(new ReadableStream<Uint8Array>(), {
    headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1", "x-session-id": "session-native", "x-operation-id": "op-native" },
  })));
  const view = renderHook(() => useChatSession(CHAT_URL));
  onTestFinished(() => view.result.current.stop());
  act(() => { void view.result.current.sendMessage({ text: "Hello" }); });
  await waitFor(() => { expect(view.result.current.sessionIdOf()).toBe("session-native"); });
  expect(view.result.current.operationIdOf()).toBe("op-native");
  expect(view.result.current.messages.filter((message) => message.role === "assistant")).toEqual([]);
});

it("uses the official GET resume transport to consume the real native snapshot without submitting a turn", async () => {
  const native = await completedNativeWatch();
  onTestFinished(native.close);
  const seen: Request[] = [];
  server.use(http.get(/\/stream(?:\?.*)?$/u, async ({ request }) => {
    seen.push(request); return native.response();
  }));
  const view = renderHook(() => useChatSession(CHAT_URL, "session-native"));
  await act(async () => { await view.result.current.resumeStream(); });
  expect(seen.map((request) => new URL(request.url).pathname)).toEqual(["/v1/conversations/session-native/stream"]);
  expect(seen[0]?.headers.get("x-byok-api-key")).toBeNull();
  const answer = view.result.current.messages.flatMap((message) => message.parts).find((part) => part.type === "data-response");
  expect(answer?.data).toMatchObject({ intent: "greet_user", message: "Native recovered answer" });
  expect(view.result.current.status).toBe("ready");
});

it("the retry action reconnects to structured native state instead of replacing it with history text", async () => {
  const native = await completedNativeWatch();
  onTestFinished(native.close);
  const reads: string[] = [];
  server.use(http.get(/\/stream(?:\?.*)?$/u, async ({ request }) => {
    reads.push(new URL(request.url).pathname); return native.response();
  }));
  server.use(http.get("*/v1/conversations/:sessionId/messages", () => HttpResponse.json({ messages: [], revision: 0, next_offset: null })));
  const view = renderHook(() => {
    const chat = useChatSession(CHAT_URL, "session-native");
    return { chat, recovery: useStreamRecovery(chat, chat.sessionIdOf) };
  });
  act(() => { view.result.current.recovery.recover(); });
  await waitFor(() => { expect(reads).toEqual(["/v1/conversations/session-native/stream"]); });
  await waitFor(() => { expect(view.result.current.chat.status).toBe("ready"); });
  expect(view.result.current.chat.messages.flatMap((message) => message.parts)).toContainEqual(expect.objectContaining({ type: "data-response" }));
});
