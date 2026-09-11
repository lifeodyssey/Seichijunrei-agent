/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, onTestFinished } from "vitest";
import { http, HttpResponse } from "msw";
import { useChatSession } from "../../../src/features/chat/use-chat-session";
import { useStreamRecovery } from "../../../src/features/chat/use-stream-recovery";
import { server } from "../../msw/node";
import { CHAT_URL } from "../../msw/chat-handlers";
import { completedNativeWatch } from "./_native-watch";

it("repeated native recovery converges on one assistant result with structured fields intact", async () => {
  const native = await completedNativeWatch();
  onTestFinished(native.close);
  const reads: string[] = [];
  server.use(http.get("*/v1/conversations/:sessionId/stream", async ({ request }) => {
    reads.push(request.url); return native.response();
  }));
  const view = renderHook(() => {
    const chat = useChatSession(CHAT_URL, "session-native");
    return { chat, recovery: useStreamRecovery(chat, chat.sessionIdOf) };
  });
  await act(async () => { await view.result.current.chat.resumeStream(); });
  act(() => { view.result.current.recovery.recover(); });
  await waitFor(() => { expect(view.result.current.recovery.recovering).toBe(false); });
  expect(reads).toHaveLength(2);
  expect(new URL(reads[1] ?? CHAT_URL).searchParams.get("operation_id")).toBe("op-native");
  expect(view.result.current.chat.messages).toHaveLength(1);
  expect(view.result.current.chat.messages[0]?.parts).toContainEqual(expect.objectContaining({ type: "data-response" }));
});

it("a return to an idle owned session stays ready without posting a model request", async () => {
  const reads: string[] = [];
  server.use(http.get("*/v1/conversations/:sessionId/stream", ({ request }) => {
    reads.push(request.method); return new HttpResponse(null, { status: 204 });
  }));
  const view = renderHook(() => useChatSession(CHAT_URL, "session-native", true));
  await waitFor(() => { expect(reads).toEqual(["GET"]); });
  expect(view.result.current.status).toBe("ready");
  expect(view.result.current.messages).toEqual([]);
});

it("a refused native read is surfaced without regenerating or clearing the failure", async () => {
  const reads: string[] = [];
  server.use(http.get("*/v1/conversations/:sessionId/stream", ({ request }) => {
    reads.push(request.method); return new HttpResponse("Conversation not found", { status: 404 });
  }));
  const view = renderHook(() => useChatSession(CHAT_URL, "session-native", true));
  await waitFor(() => { expect(view.result.current.status).toBe("error"); });
  expect(reads).toEqual(["GET"]);
  expect(view.result.current.messages).toEqual([]);
  expect(view.result.current.lastHttpStatus()).toBe(404);
});
