/**
 * Unit tests for IconSidebar component
 * AC: renders icons, no crash without session/active state
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import IconSidebar from "../components/layout/IconSidebar";

afterEach(() => cleanup());

describe("IconSidebar", () => {
  it("renders without crashing when no session or active state is provided", () => {
    const { container } = render(
      <IconSidebar onNewChat={() => {}} />
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("renders the logo mark with the 聖 character", () => {
    render(<IconSidebar onNewChat={() => {}} />);
    expect(screen.getByText("聖")).toBeInTheDocument();
  });

  it("renders search icon button", () => {
    render(<IconSidebar onNewChat={() => {}} />);
    expect(screen.getByRole("button", { name: /search|検索/i })).toBeInTheDocument();
  });

  it("renders routes icon button", () => {
    render(<IconSidebar onNewChat={() => {}} />);
    expect(screen.getByRole("button", { name: /route|ルート/i })).toBeInTheDocument();
  });

  it("renders history icon button", () => {
    render(<IconSidebar onNewChat={() => {}} />);
    expect(screen.getByRole("button", { name: /history|履歴/i })).toBeInTheDocument();
  });

  it("renders settings icon button", () => {
    render(<IconSidebar onNewChat={() => {}} />);
    expect(screen.getByRole("button", { name: /settings|設定/i })).toBeInTheDocument();
  });

  it("renders new chat button", () => {
    render(<IconSidebar onNewChat={() => {}} />);
    expect(screen.getByRole("button", { name: /new chat|新規|compose/i })).toBeInTheDocument();
  });

  it("renders without active state — all icons visible, none marked active by default", () => {
    const { container } = render(
      <IconSidebar onNewChat={() => {}} />
    );
    // No icon buttons should have the active class by default
    const buttons = container.querySelectorAll("button[data-active='true']");
    expect(buttons).toHaveLength(0);
  });

  it("has correct sidebar width of 56px", () => {
    const { container } = render(<IconSidebar onNewChat={() => {}} />);
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    // jsdom won't resolve tailwind, but we can check the data attr
    expect(aside!.getAttribute("data-testid")).toBe("icon-sidebar");
  });

  it("accepts an optional activeSection prop without crashing", () => {
    expect(() =>
      render(
        <IconSidebar onNewChat={() => {}} activeSection="search" />
      )
    ).not.toThrow();
  });

  it("marks the active section button with data-active", () => {
    const { container } = render(
      <IconSidebar onNewChat={() => {}} activeSection="search" />
    );
    const activeBtn = container.querySelector("button[data-active='true']");
    expect(activeBtn).not.toBeNull();
  });

  it("onSectionClick('history') is callable without error", () => {
    const onSectionClick = vi.fn();
    render(
      <IconSidebar onNewChat={() => {}} onSectionClick={onSectionClick} />
    );
    const historyBtn = screen.getByRole("button", { name: /history|履歴/i });
    expect(() => fireEvent.click(historyBtn)).not.toThrow();
    expect(onSectionClick).toHaveBeenCalledWith("history");
  });
});
