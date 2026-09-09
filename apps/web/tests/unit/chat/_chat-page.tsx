import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, useRouterState } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { ChatPage } from "../../../src/features/chat/ChatPage";
import { ChatEntryGate } from "../../../src/features/chat/ChatEntryGate";
import { parseChatSearch } from "../../../src/features/chat/search";
import type { ChatSearch } from "../../../src/features/chat/search";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { server } from "../../msw/node";
import { healthzOkHandler } from "../../msw/chat-handlers";
import { makeAppRouter } from "../_router";

// jsdom does not implement scrollIntoView; the anchor effect needs a stub.
Element.prototype.scrollIntoView = () => undefined;

const EMPTY_SEARCH: ChatSearch = { q: undefined, session: undefined, route: undefined };

// The harness hands the router's URL search to ChatPage exactly as the real
// route does, without any second local owner.
function ChatHarness() {
  const search = parseChatSearch(useRouterState({ select: (state) => state.location.search }));
  return <ChatPage search={search} />;
}

function EntryHarness() {
  const search = parseChatSearch(useRouterState({ select: (state) => state.location.search }));
  return <ChatEntryGate><ChatPage search={search} /></ChatEntryGate>;
}

export function chatSearch(overrides: Partial<ChatSearch> = {}): ChatSearch {
  return { ...EMPTY_SEARCH, ...overrides };
}

/** Render the chat page with a fresh QueryClient; healthz answers OK by default. */
export function renderChatPage(search: ChatSearch = EMPTY_SEARCH, healthy = true) {
  if (healthy) server.use(healthzOkHandler);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = makeAppRouter(searchHref(search));
  render(
    <RouterContextProvider router={router}>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <ChatHarness />
        </LocaleProvider>
      </QueryClientProvider>
    </RouterContextProvider>,
  );
  return router;
}

export function renderChatEntry(search: ChatSearch = EMPTY_SEARCH, healthy = true) {
  if (healthy) server.use(healthzOkHandler);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = makeAppRouter(searchHref(search));
  render(
    <RouterContextProvider router={router}>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider><EntryHarness /></LocaleProvider>
      </QueryClientProvider>
    </RouterContextProvider>,
  );
  return router;
}

function searchHref(search: ChatSearch): string {
  const params = new URLSearchParams();
  if (search.q !== undefined) params.set("q", search.q);
  if (search.session !== undefined) params.set("session", search.session);
  if (search.route !== undefined) params.set("route", search.route);
  const query = params.toString();
  return query === "" ? "/chat" : `/chat?${query}`;
}
