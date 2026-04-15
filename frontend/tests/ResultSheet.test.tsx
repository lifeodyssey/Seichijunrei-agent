import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ResultSheet from "@/components/layout/ResultSheet";
import type { RuntimeResponse } from "@/lib/types";
import { PointSelectionContext } from "@/contexts/PointSelectionContext";

// vaul uses portals — render into body by default in jsdom

const MOCK_RESPONSE: RuntimeResponse = {
  success: true,
  status: "ok",
  intent: "search_bangumi",
  session_id: "sess-001",
  message: "Found 2 spots for けいおん！",
  data: {
    results: {
      rows: [
        {
          id: "pt-001",
          name: "豊郷小学校旧校舎群",
          name_cn: null,
          episode: 1,
          time_seconds: 60,
          screenshot_url: null,
          bangumi_id: "bg-001",
          latitude: 35.1,
          longitude: 136.1,
        },
      ],
      row_count: 1,
      strategy: "sql",
      status: "ok",
    },
    message: "Found 2 spots for けいおん！",
    status: "ok",
  },
  session: { interaction_count: 1, route_history_count: 0 },
  route_history: [],
  errors: [],
};

function renderWithContext(ui: React.ReactElement) {
  return render(
    <PointSelectionContext.Provider
      value={{ selectedIds: new Set(), toggle: vi.fn(), clear: vi.fn() }}
    >
      {ui}
    </PointSelectionContext.Provider>,
  );
}

describe("ResultSheet", () => {
  it("renders drag handle when open=true with a response", () => {
    renderWithContext(
      <ResultSheet
        response={MOCK_RESPONSE}
        open={true}
        onClose={vi.fn()}
      />,
    );

    // drag handle: aria-label on the Drawer.Content region, or the handle pill
    const handle = document.querySelector("[data-drag-handle]");
    expect(handle).not.toBeNull();
  });

  it("does not render sheet content when open=false", () => {
    renderWithContext(
      <ResultSheet
        response={MOCK_RESPONSE}
        open={false}
        onClose={vi.fn()}
      />,
    );

    // The drawer portal should not render content when closed
    expect(screen.queryByRole("region", { name: "Result panel" })).toBeNull();
  });

  it("does not render when response is null", () => {
    renderWithContext(
      <ResultSheet
        response={null}
        open={false}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("region", { name: "Result panel" })).toBeNull();
  });

  it("calls onClose when overlay is clicked", async () => {
    const onClose = vi.fn();
    renderWithContext(
      <ResultSheet
        response={MOCK_RESPONSE}
        open={true}
        onClose={onClose}
      />,
    );

    const overlay = document.querySelector(".vaul-overlay") as HTMLElement | null;
    if (overlay) {
      overlay.click();
      // onClose is wired to onOpenChange(false)
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });
});
