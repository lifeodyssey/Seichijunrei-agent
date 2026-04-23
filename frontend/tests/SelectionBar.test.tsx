/**
 * SelectionBar — selection count, origin input, route/clear buttons.
 *
 * AC coverage:
 * - Renders count text -> unit
 * - Renders origin input -> unit
 * - Clicking route button calls onRoute with origin -> unit
 * - Clicking clear button calls onClear -> unit
 * - Enter key in input triggers route -> unit
 * - Disabled state prevents route action -> unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SelectionBar from "@/components/generative/SelectionBar";
import defaultDict from "@/lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

describe("SelectionBar", () => {
  const defaultProps = {
    count: 3,
    defaultOrigin: "東京駅",
    onRoute: vi.fn(),
    onClear: vi.fn(),
  };

  function renderBar(overrides: Partial<typeof defaultProps> = {}) {
    const props = { ...defaultProps, ...overrides, onRoute: overrides.onRoute ?? vi.fn(), onClear: overrides.onClear ?? vi.fn() };
    return { ...render(<SelectionBar {...props} />), props };
  }

  it("renders count text", () => {
    renderBar();
    // The ja dict uses "{count}件を選択中"
    expect(screen.getByText("3件を選択中")).toBeInTheDocument();
  });

  it("renders origin input with default value", () => {
    renderBar();
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("東京駅");
  });

  it("renders route and clear buttons", () => {
    renderBar();
    // ja dict: route = "ルート化", clear = "クリア"
    expect(screen.getByText("ルート化")).toBeInTheDocument();
    expect(screen.getByText("クリア")).toBeInTheDocument();
  });

  it("clicking route button calls onRoute with current origin", async () => {
    const onRoute = vi.fn();
    renderBar({ onRoute });

    await userEvent.click(screen.getByText("ルート化"));

    expect(onRoute).toHaveBeenCalledWith("東京駅");
  });

  it("clicking route button uses updated origin from input", async () => {
    const onRoute = vi.fn();
    renderBar({ onRoute });

    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "大阪駅");
    await userEvent.click(screen.getByText("ルート化"));

    expect(onRoute).toHaveBeenCalledWith("大阪駅");
  });

  it("clicking clear button calls onClear", async () => {
    const onClear = vi.fn();
    renderBar({ onClear });

    await userEvent.click(screen.getByText("クリア"));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("Enter key in input triggers onRoute", () => {
    const onRoute = vi.fn();
    renderBar({ onRoute });

    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRoute).toHaveBeenCalledWith("東京駅");
  });

  it("route button is disabled when count is 0", () => {
    renderBar({ count: 0 });
    const routeBtn = screen.getByText("ルート化");
    expect(routeBtn).toBeDisabled();
  });

  it("route action does nothing when disabled", async () => {
    const onRoute = vi.fn();
    renderBar({ onRoute, count: 3 });

    // Re-render with disabled prop
    renderBar({ onRoute, count: 3 });

    // Render again with disabled=true
    const { container } = render(
      <SelectionBar count={3} defaultOrigin="東京駅" onRoute={onRoute} onClear={vi.fn()} disabled />,
    );

    const routeBtn = container.querySelector("button");
    expect(routeBtn).toBeDisabled();
  });
});
