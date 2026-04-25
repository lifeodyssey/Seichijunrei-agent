/**
 * DesktopConversationSidebar — persistent sidebar for desktop viewports.
 *
 * AC coverage:
 * - Sidebar renders conversation list on desktop (>= 1024px) -> unit
 * - Sidebar is hidden on mobile -> unit
 * - Clicking a conversation calls onSelectConversation -> unit
 * - New chat button calls onNewChat -> unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DesktopConversationSidebar from "@/components/layout/DesktopConversationSidebar";
import type { ConversationRecord } from "@/lib/types";

const CONVERSATIONS: ConversationRecord[] = [
  {
    session_id: "sess-d01",
    title: "京アニ聖地巡礼",
    first_query: "京アニの聖地を探して",
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T12:00:00.000Z",
  },
  {
    session_id: "sess-d02",
    title: null,
    first_query: "ルートを計画して",
    created_at: "2026-04-02T00:00:00.000Z",
    updated_at: "2026-04-02T08:00:00.000Z",
  },
];

describe("DesktopConversationSidebar", () => {
  it("renders conversation list", () => {
    render(
      <DesktopConversationSidebar
        conversations={CONVERSATIONS}
        activeSessionId={null}
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );

    expect(screen.getByText("京アニ聖地巡礼")).toBeInTheDocument();
    expect(screen.getByText("ルートを計画して")).toBeInTheDocument();
  });

  it("has desktop-only visibility class", () => {
    const { container } = render(
      <DesktopConversationSidebar
        conversations={CONVERSATIONS}
        activeSessionId={null}
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );

    const sidebar = container.firstElementChild;
    expect(sidebar).toHaveClass("hidden");
    expect(sidebar).toHaveClass("lg:flex");
  });

  it("calls onSelectConversation when a conversation is clicked", () => {
    const onSelect = vi.fn();
    render(
      <DesktopConversationSidebar
        conversations={CONVERSATIONS}
        activeSessionId={null}
        onSelectConversation={onSelect}
        onNewChat={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("conversation-item-sess-d01"));
    expect(onSelect).toHaveBeenCalledWith("sess-d01");
  });

  it("calls onNewChat when new chat button is clicked", () => {
    const onNewChat = vi.fn();
    render(
      <DesktopConversationSidebar
        conversations={CONVERSATIONS}
        activeSessionId={null}
        onSelectConversation={vi.fn()}
        onNewChat={onNewChat}
      />,
    );

    fireEvent.click(screen.getByTestId("desktop-sidebar-new-chat"));
    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it("highlights active conversation", () => {
    render(
      <DesktopConversationSidebar
        conversations={CONVERSATIONS}
        activeSessionId="sess-d01"
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );

    const item = screen.getByTestId("conversation-item-sess-d01");
    expect(item).toHaveAttribute("data-active", "true");
  });

  it("shows empty state when no conversations", () => {
    render(
      <DesktopConversationSidebar
        conversations={[]}
        activeSessionId={null}
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );

    expect(screen.getByTestId("conversation-drawer-empty")).toBeInTheDocument();
  });
});
