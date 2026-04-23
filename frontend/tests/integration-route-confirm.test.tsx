/**
 * Integration test: Route confirmation flow.
 *
 * Tests the multi-step flow:
 * - RouteConfirm renders 3 points with names
 * - Remove a point via the remove button
 * - Undo toast appears
 * - Click undo restores the point
 * - Click confirm calls onConfirm with correct IDs and origin
 *
 * Mocks: i18n-context
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RouteConfirm from "@/components/generative/RouteConfirm";
import type { PilgrimagePoint } from "@/lib/types";
import defaultDict from "@/lib/dictionaries/ja.json";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
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

const POINT_A = makePoint("pt-a", {
  name: "宇治駅",
  name_cn: "宇治站",
  episode: 1,
  latitude: 34.88,
  longitude: 135.80,
});
const POINT_B = makePoint("pt-b", {
  name: "平等院",
  name_cn: "平等院",
  episode: 2,
  latitude: 34.89,
  longitude: 135.81,
});
const POINT_C = makePoint("pt-c", {
  name: "伏見稲荷",
  name_cn: "伏見稲荷大社",
  episode: 3,
  latitude: 34.97,
  longitude: 135.77,
});

const THREE_POINTS = [POINT_A, POINT_B, POINT_C];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration: Route confirmation flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all 3 points with their display names", () => {
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    // name_cn is used as display name when available
    expect(screen.getByText("宇治站")).toBeInTheDocument();
    expect(screen.getByText("平等院")).toBeInTheDocument();
    expect(screen.getByText("伏見稲荷大社")).toBeInTheDocument();
  });

  it("shows summary with correct count", () => {
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    // ja dict: "{count} か所の聖地が待っています"
    expect(screen.getByText(/3 か所の聖地/)).toBeInTheDocument();
  });

  it("removes a point and shows undo toast", async () => {
    const user = userEvent.setup();
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    // Click the remove button for 宇治站
    const removeBtn = screen.getByLabelText("移除 宇治站");
    await user.click(removeBtn);

    // 宇治站 should be gone
    expect(screen.queryByText("宇治站")).not.toBeInTheDocument();

    // Undo toast should appear with the removed name
    // ja dict: "「{name}」を削除しました"
    expect(screen.getByText(/を削除しました/)).toBeInTheDocument();
    expect(screen.getByText(defaultDict.route_confirm.undo)).toBeInTheDocument();

    // Summary should update to 2
    expect(screen.getByText(/2 か所の聖地/)).toBeInTheDocument();
  });

  it("clicking undo restores the removed point", async () => {
    const user = userEvent.setup();
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    // Remove 宇治站
    await user.click(screen.getByLabelText("移除 宇治站"));
    expect(screen.queryByText("宇治站")).not.toBeInTheDocument();

    // Click undo
    await user.click(screen.getByText(defaultDict.route_confirm.undo));

    // Point should be restored
    expect(screen.getByText("宇治站")).toBeInTheDocument();

    // Count should be back to 3
    expect(screen.getByText(/3 か所の聖地/)).toBeInTheDocument();
  });

  it("calls onConfirm with ordered IDs and origin on confirm click", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );

    // Click the confirm/start button
    // ja dict: "ルート計画を開始"
    const confirmBtn = screen.getByText(defaultDict.route_confirm.start);
    await user.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(
      ["pt-a", "pt-b", "pt-c"],
      "京都駅",
    );
  });

  it("calls onConfirm with updated origin after user changes departure input", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );

    // Change departure input
    const input = screen.getByPlaceholderText(
      defaultDict.route_confirm.departure_placeholder,
    );
    await user.clear(input);
    await user.type(input, "東京駅");

    // Confirm
    await user.click(screen.getByText(defaultDict.route_confirm.start));

    expect(onConfirm).toHaveBeenCalledWith(
      ["pt-a", "pt-b", "pt-c"],
      "東京駅",
    );
  });

  it("remove then undo then confirm preserves full point list", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );

    // Remove 平等院
    await user.click(screen.getByLabelText("移除 平等院"));
    expect(screen.queryByText("平等院")).not.toBeInTheDocument();

    // Undo
    await user.click(screen.getByText(defaultDict.route_confirm.undo));
    expect(screen.getByText("平等院")).toBeInTheDocument();

    // Confirm — all 3 IDs should be present
    await user.click(screen.getByText(defaultDict.route_confirm.start));
    expect(onConfirm).toHaveBeenCalledWith(
      ["pt-a", "pt-b", "pt-c"],
      "京都駅",
    );
  });

  it("confirm button is disabled after removing down to 1 point", async () => {
    const user = userEvent.setup();
    render(
      <RouteConfirm
        points={THREE_POINTS}
        defaultOrigin="京都駅"
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    // Remove two points
    await user.click(screen.getByLabelText("移除 宇治站"));
    await user.click(screen.getByLabelText("移除 平等院"));

    // Confirm button should be disabled (need >= 2 points)
    const confirmBtn = screen.getByText(defaultDict.route_confirm.start);
    expect(confirmBtn.closest("button")).toBeDisabled();
  });
});
