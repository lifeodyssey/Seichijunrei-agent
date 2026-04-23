import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResultPanelToolbar } from "../components/layout/ResultPanelToolbar";
import defaultDict from "../lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

const baseProps = {
  view: "grid" as const,
  onViewChange: vi.fn(),
  filterMode: "episode" as const,
  onFilterModeChange: vi.fn(),
  epRanges: ["EP 1-4", "EP 5-8"],
  activeEpRange: null,
  onEpRangeChange: vi.fn(),
  areas: ["宇治", "京都"],
  activeArea: null,
  onAreaChange: vi.fn(),
};

describe("ResultPanelToolbar", () => {
  it("renders filter tabs (episode and area)", () => {
    render(<ResultPanelToolbar {...baseProps} />);

    expect(screen.getByText(defaultDict.toolbar.tab_episode)).toBeInTheDocument();
    expect(screen.getByText(defaultDict.toolbar.tab_area)).toBeInTheDocument();
  });

  it("clicking area tab calls onFilterModeChange with 'area'", () => {
    const onFilterModeChange = vi.fn();
    render(
      <ResultPanelToolbar {...baseProps} onFilterModeChange={onFilterModeChange} />,
    );

    fireEvent.click(screen.getByText(defaultDict.toolbar.tab_area));
    expect(onFilterModeChange).toHaveBeenCalledWith("area");
  });

  it("clicking episode tab calls onFilterModeChange with 'episode'", () => {
    const onFilterModeChange = vi.fn();
    render(
      <ResultPanelToolbar {...baseProps} onFilterModeChange={onFilterModeChange} />,
    );

    fireEvent.click(screen.getByText(defaultDict.toolbar.tab_episode));
    expect(onFilterModeChange).toHaveBeenCalledWith("episode");
  });

  it("renders view toggle buttons (grid and map)", () => {
    render(<ResultPanelToolbar {...baseProps} />);

    expect(screen.getByText(defaultDict.toolbar.grid)).toBeInTheDocument();
    expect(screen.getByText(defaultDict.toolbar.map)).toBeInTheDocument();
  });

  it("clicking map view calls onViewChange with 'map'", () => {
    const onViewChange = vi.fn();
    render(<ResultPanelToolbar {...baseProps} onViewChange={onViewChange} />);

    fireEvent.click(screen.getByText(defaultDict.toolbar.map));
    expect(onViewChange).toHaveBeenCalledWith("map");
  });

  it("clicking grid view calls onViewChange with 'grid'", () => {
    const onViewChange = vi.fn();
    render(<ResultPanelToolbar {...baseProps} onViewChange={onViewChange} />);

    fireEvent.click(screen.getByText(defaultDict.toolbar.grid));
    expect(onViewChange).toHaveBeenCalledWith("grid");
  });

  it("renders 'All' chip and filter chips in episode mode", () => {
    render(<ResultPanelToolbar {...baseProps} />);

    expect(screen.getByText(defaultDict.toolbar.all)).toBeInTheDocument();
    expect(screen.getByText("EP 1-4")).toBeInTheDocument();
    expect(screen.getByText("EP 5-8")).toBeInTheDocument();
  });

  it("renders area chips when filterMode is area", () => {
    render(<ResultPanelToolbar {...baseProps} filterMode="area" />);

    expect(screen.getByText(defaultDict.toolbar.all)).toBeInTheDocument();
    expect(screen.getByText("宇治")).toBeInTheDocument();
    expect(screen.getByText("京都")).toBeInTheDocument();
  });

  it("clicking 'All' chip resets filter to null", () => {
    const onEpRangeChange = vi.fn();
    render(
      <ResultPanelToolbar {...baseProps} onEpRangeChange={onEpRangeChange} />,
    );

    fireEvent.click(screen.getByText(defaultDict.toolbar.all));
    expect(onEpRangeChange).toHaveBeenCalledWith(null);
  });

  it("clicking a chip calls the appropriate change handler", () => {
    const onEpRangeChange = vi.fn();
    render(
      <ResultPanelToolbar {...baseProps} onEpRangeChange={onEpRangeChange} />,
    );

    fireEvent.click(screen.getByText("EP 1-4"));
    expect(onEpRangeChange).toHaveBeenCalledWith("EP 1-4");
  });

  it("does not render chip row when no chips available", () => {
    render(
      <ResultPanelToolbar {...baseProps} epRanges={[]} />,
    );

    // "All" chip should not appear when there are no filter chips
    expect(screen.queryByText(defaultDict.toolbar.all)).not.toBeInTheDocument();
  });
});
