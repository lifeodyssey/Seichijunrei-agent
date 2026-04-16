import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ConversationDrawer from "@/components/layout/ConversationDrawer";
import type { ConversationRecord } from "@/lib/types";

const CONVERSATIONS: ConversationRecord[] = [
  {
    session_id: "sess-001",
    title: "宇治聖地巡礼",
    first_query: "宇治の聖地を探して",
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T12:00:00.000Z",
  },
  {
    session_id: "sess-002",
    title: null,
    first_query: "ルートを計画して",
    created_at: "2026-04-02T00:00:00.000Z",
    updated_at: "2026-04-02T08:00:00.000Z",
  },
];

describe("ConversationDrawer", () => {
  it("renders conversation list when open=true", () => {
    render(
      <ConversationDrawer
        open={true}
        onClose={vi.fn()}
        conversations={CONVERSATIONS}
        activeSessionId={null}
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );

    expect(screen.getByText("宇治聖地巡礼")).toBeInTheDocument();
    expect(screen.getByText("ルートを計画して")).toBeInTheDocument();
  });

  it("shows empty state when conversation list is empty", () => {
    render(
      <ConversationDrawer
        open={true}
        onClose={vi.fn()}
        conversations={[]}
        activeSessionId={null}
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );

    // Should render some empty-state indicator
    expect(screen.getByTestId("conversation-drawer-empty")).toBeInTheDocument();
  });

  it("does not render drawer content when closed", () => {
    render(
      <ConversationDrawer
        open={false}
        onClose={vi.fn()}
        conversations={CONVERSATIONS}
        activeSessionId={null}
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );

    // Drawer is closed, content should not be visible
    expect(screen.queryByText("宇治聖地巡礼")).toBeNull();
  });

  it("applies active styling to the active conversation", () => {
    render(
      <ConversationDrawer
        open={true}
        onClose={vi.fn()}
        conversations={CONVERSATIONS}
        activeSessionId="sess-001"
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );

    // getByTestId throws when multiple match — use getAllByTestId and find the active one
    const items = screen.getAllByTestId("conversation-item-sess-001");
    // One of the items should have the active bg class
    const activeItem = items.find((el) =>
      el.className.includes("bg-[var(--color-primary)]"),
    );
    expect(activeItem).toBeDefined();
  });
});
