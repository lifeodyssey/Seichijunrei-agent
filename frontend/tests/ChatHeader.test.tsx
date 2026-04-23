import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChatHeader from "../components/layout/ChatHeader";
import defaultDict from "../lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

describe("ChatHeader", () => {
  it("renders the header title", () => {
    render(<ChatHeader />);
    expect(screen.getByText(defaultDict.header.title)).toBeInTheDocument();
  });

  it("renders new chat button when onNewChat is provided", () => {
    const onNewChat = vi.fn();
    render(<ChatHeader onNewChat={onNewChat} />);
    expect(screen.getByText(defaultDict.sidebar.new_chat)).toBeInTheDocument();
  });

  it("does not render new chat button when onNewChat is not provided", () => {
    render(<ChatHeader />);
    expect(screen.queryByText(defaultDict.sidebar.new_chat)).not.toBeInTheDocument();
  });

  it("clicking new chat calls onNewChat", () => {
    const onNewChat = vi.fn();
    render(<ChatHeader onNewChat={onNewChat} />);

    fireEvent.click(screen.getByText(defaultDict.sidebar.new_chat));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("renders menu toggle button when onMenuToggle is provided", () => {
    const onMenuToggle = vi.fn();
    render(<ChatHeader onMenuToggle={onMenuToggle} />);

    const toggleBtn = screen.getByLabelText("Toggle sidebar");
    expect(toggleBtn).toBeInTheDocument();
  });

  it("does not render menu toggle button when onMenuToggle is not provided", () => {
    render(<ChatHeader />);
    expect(screen.queryByLabelText("Toggle sidebar")).not.toBeInTheDocument();
  });

  it("clicking menu toggle calls onMenuToggle", () => {
    const onMenuToggle = vi.fn();
    render(<ChatHeader onMenuToggle={onMenuToggle} />);

    fireEvent.click(screen.getByLabelText("Toggle sidebar"));
    expect(onMenuToggle).toHaveBeenCalledTimes(1);
  });
});
