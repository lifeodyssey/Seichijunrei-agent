import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import IconSidebar from "../components/layout/IconSidebar";

// IconSidebar uses cn from @/lib/utils, no i18n mock needed — it uses hardcoded Chinese labels

describe("IconSidebar", () => {
  it("renders the sidebar element", () => {
    render(<IconSidebar onNewChat={vi.fn()} />);
    expect(screen.getByTestId("icon-sidebar")).toBeInTheDocument();
  });

  it("renders navigation buttons with aria-labels", () => {
    render(<IconSidebar onNewChat={vi.fn()} />);

    expect(screen.getByLabelText("新对话")).toBeInTheDocument();
    expect(screen.getByLabelText("历史")).toBeInTheDocument();
    expect(screen.getByLabelText("收藏")).toBeInTheDocument();
    expect(screen.getByLabelText("设置")).toBeInTheDocument();
    expect(screen.getByLabelText("聖地巡礼 home")).toBeInTheDocument();
  });

  it("clicking new chat button calls onNewChat", () => {
    const onNewChat = vi.fn();
    render(<IconSidebar onNewChat={onNewChat} />);

    fireEvent.click(screen.getByLabelText("新对话"));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("clicking the logo/home button also calls onNewChat", () => {
    const onNewChat = vi.fn();
    render(<IconSidebar onNewChat={onNewChat} />);

    fireEvent.click(screen.getByLabelText("聖地巡礼 home"));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("clicking history button calls onSectionClick with 'history'", () => {
    const onSectionClick = vi.fn();
    render(<IconSidebar onNewChat={vi.fn()} onSectionClick={onSectionClick} />);

    fireEvent.click(screen.getByLabelText("历史"));
    expect(onSectionClick).toHaveBeenCalledWith("history");
  });

  it("clicking favorites button calls onSectionClick with 'favorites'", () => {
    const onSectionClick = vi.fn();
    render(<IconSidebar onNewChat={vi.fn()} onSectionClick={onSectionClick} />);

    fireEvent.click(screen.getByLabelText("收藏"));
    expect(onSectionClick).toHaveBeenCalledWith("favorites");
  });

  it("clicking settings button calls onSectionClick with 'settings'", () => {
    const onSectionClick = vi.fn();
    render(<IconSidebar onNewChat={vi.fn()} onSectionClick={onSectionClick} />);

    fireEvent.click(screen.getByLabelText("设置"));
    expect(onSectionClick).toHaveBeenCalledWith("settings");
  });

  it("highlights the active section", () => {
    render(
      <IconSidebar
        onNewChat={vi.fn()}
        onSectionClick={vi.fn()}
        activeSection="history"
      />,
    );

    const historyBtn = screen.getByLabelText("历史");
    expect(historyBtn).toHaveAttribute("data-active", "true");

    const favBtn = screen.getByLabelText("收藏");
    expect(favBtn).toHaveAttribute("data-active", "false");
  });

  it("does not crash when onSectionClick is not provided", () => {
    render(<IconSidebar onNewChat={vi.fn()} />);

    // Clicking history should not throw
    expect(() => {
      fireEvent.click(screen.getByLabelText("历史"));
    }).not.toThrow();
  });
});
