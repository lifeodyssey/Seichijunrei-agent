/** @vitest-environment jsdom */
import { act, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../msw/node";
import { chatSearch, renderChatPage } from "./_chat-page";

it("keeps already loaded history visible when resume sends identity headers but no assistant snapshot", async () => {
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  server.use(http.get("*/v1/conversations/session-native/messages", () => HttpResponse.json({
    messages: [{ role: "user", content: "Hello", created_at: "2026-09-10T00:00:00Z", operation_id: "op-native" },
      { role: "assistant", content: "Previously committed answer", created_at: "2026-09-10T00:00:00Z", operation_id: "op-native" }], revision: 5, next_offset: null,
  })));
  server.use(http.get("*/v1/conversations/session-native/stream", () => new HttpResponse(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), {
    headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1", "x-session-id": "session-native", "x-operation-id": "op-native" },
  })));
  renderChatPage(chatSearch({ session: "session-native" }));
  await screen.findByText("Hello");
  await waitFor(() => { expect(stream).toBeDefined(); });
  expect(screen.queryByText("Previously committed answer")).toBeTruthy();
  act(() => { stream?.error(new Error("connection lost before snapshot")); });
  await waitFor(() => { expect(document.querySelector(".chat-typing")).toBeNull(); });
  expect(screen.queryByText("Previously committed answer")).toBeTruthy();
});
