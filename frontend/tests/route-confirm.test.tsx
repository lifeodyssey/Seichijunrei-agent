/**
 * RouteConfirm unit tests.
 *
 * AC coverage:
 * - Renders point list with correct count -> unit
 * - Shows departure input -> unit
 * - Shows confirm button (disabled when < 2 points) -> unit
 * - Remove button removes a point from list -> unit
 * - Undo toast appears after removal -> unit
 * - Undo restores the removed point -> unit
 * - Calls onConfirm with ordered IDs and origin when confirmed -> unit
 * - Calls onBack when back button clicked -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RouteConfirm from "@/components/generative/RouteConfirm";
import type { PilgrimagePoint } from "@/lib/types";
import zhDict from "@/lib/dictionaries/zh.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => zhDict,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePoint(
  id: string,
  overrides: Partial<PilgrimagePoint> = {},
): PilgrimagePoint {
  return {
    id,
    name: `スポット-${id}`,
    name_cn: null,
    episode: null,
    time_seconds: null,
    screenshot_url: null,
    bangumi_id: "bg-001",
    latitude: 34.88,
    longitude: 135.8,
    ...overrides,
  };
}

const POINT_A = makePoint("pt-a", { name: "宇治駅", name_cn: "宇治站", episode: 1, latitude: 34.88, longitude: 135.80 });
const POINT_B = makePoint("pt-b", { name: "平等院", name_cn: "平等院", episode: 2, latitude: 34.89, longitude: 135.81 });
const POINT_C = makePoint("pt-c", { name: "伏見稲荷", name_cn: "伏见稻荷", episode: 3, latitude: 34.97, longitude: 135.77 });

const THREE_POINTS = [POINT_A, POINT_B, POINT_C];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RouteConfirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders point list with correct count", () => {
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText("宇治站")).toBeInTheDocument();
    expect(screen.getByText("平等院")).toBeInTheDocument();
    expect(screen.getByText("伏见稻荷")).toBeInTheDocument();
    // Summary line shows count
    expect(screen.getByText(/3 个圣地/)).toBeInTheDocument();
  });

  it("shows departure input with default origin", () => {
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(zhDict.route_confirm.departure_placeholder);
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("京都駅");
  });

  it("shows confirm button disabled when fewer than 2 points", () => {
    render(
      <RouteConfirm
        points={[POINT_A]}
        defaultOrigin="京都駅"
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByText(zhDict.route_confirm.start);
    expect(confirmBtn.closest("button")).toBeDisabled();
  });

  it("shows confirm button enabled when 2 or more points", () => {
    render(
      <RouteConfirm
        points={[POINT_A, POINT_B]}
        defaultOrigin="京都駅"
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByText(zhDict.route_confirm.start);
    expect(confirmBtn.closest("button")).not.toBeDisabled();
  });

  it("removes a point when remove button is clicked", () => {
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    // Remove "宇治站" using its aria-label
    const removeBtn = screen.getByLabelText("移除 宇治站");
    fireEvent.click(removeBtn);
    expect(screen.queryByText("宇治站")).toBeNull();
    expect(screen.getByText("平等院")).toBeInTheDocument();
    expect(screen.getByText("伏见稻荷")).toBeInTheDocument();
  });

  it("shows undo toast after removal", () => {
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("移除 宇治站"));
    // Undo toast text: "已移除「宇治站」"
    expect(screen.getByText(/已移除/)).toBeInTheDocument();
    expect(screen.getByText(zhDict.route_confirm.undo)).toBeInTheDocument();
  });

  it("undo restores the removed point", () => {
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("移除 宇治站"));
    expect(screen.queryByText("宇治站")).toBeNull();

    // Click undo
    fireEvent.click(screen.getByText(zhDict.route_confirm.undo));
    expect(screen.getByText("宇治站")).toBeInTheDocument();
  });

  it("calls onConfirm with ordered IDs and origin when confirmed", () => {
    const onConfirm = vi.fn();
    render(
      <RouteConfirm
        points={[POINT_A, POINT_B]}
        defaultOrigin="京都駅"
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(zhDict.route_confirm.start));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(["pt-a", "pt-b"], "京都駅");
  });

  it("calls onConfirm with updated origin when user changes the departure input", () => {
    const onConfirm = vi.fn();
    render(
      <RouteConfirm
        points={[POINT_A, POINT_B]}
        defaultOrigin="京都駅"
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(zhDict.route_confirm.departure_placeholder);
    fireEvent.change(input, { target: { value: "東京駅" } });
    fireEvent.click(screen.getByText(zhDict.route_confirm.start));
    expect(onConfirm).toHaveBeenCalledWith(["pt-a", "pt-b"], "東京駅");
  });

  it("calls onBack when back button is clicked", () => {
    const onBack = vi.fn();
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={vi.fn()}
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByText(zhDict.route_confirm.back));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
