import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ThinkingProcess from "../components/chat/ThinkingProcess";
import type { StepEvent } from "../lib/types";
import defaultDict from "../lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

const makeStep = (
  tool: string,
  status: StepEvent["status"] = "done",
  observation?: string,
): StepEvent => ({ tool, status, observation });

describe("ThinkingProcess", () => {
  it("renders step labels from the thinking dict when steps are provided", () => {
    const steps: StepEvent[] = [
      makeStep("resolve_anime", "done", "Found anime"),
      makeStep("search_bangumi", "done", "Found 5 spots"),
    ];
    render(<ThinkingProcess steps={steps} isStreaming={false} />);

    // The collapsed summary shows observations joined by arrows
    expect(screen.getByText(/Found anime/)).toBeInTheDocument();
    expect(screen.getByText(/Found 5 spots/)).toBeInTheDocument();
  });

  it("shows streaming indicator when isStreaming=true", () => {
    const steps: StepEvent[] = [makeStep("resolve_anime", "running")];
    render(<ThinkingProcess steps={steps} isStreaming={true} />);

    // When streaming with steps, the brain emoji should have animate-pulse class
    const brainElements = screen.getAllByText("\uD83E\uDDE0");
    const pulsingBrain = brainElements.find((el) =>
      el.className.includes("animate-pulse"),
    );
    expect(pulsingBrain).toBeDefined();
  });

  it("does not show streaming indicator when isStreaming=false and steps are done", () => {
    const steps: StepEvent[] = [makeStep("resolve_anime", "done", "OK")];
    render(<ThinkingProcess steps={steps} isStreaming={false} />);

    const brainElements = screen.getAllByText("\uD83E\uDDE0");
    // When not streaming, the brain emoji should NOT have animate-pulse
    const pulsingBrain = brainElements.find((el) =>
      el.className.includes("animate-pulse"),
    );
    expect(pulsingBrain).toBeUndefined();
  });

  it("renders tool icon emoji for each step when expanded", () => {
    const steps: StepEvent[] = [
      makeStep("resolve_anime", "done", "OK"),
      makeStep("plan_route", "done", "Route planned"),
    ];
    render(<ThinkingProcess steps={steps} isStreaming={true} />);

    // Component starts expanded when isStreaming=true
    // resolve_anime icon is magnifying glass
    expect(screen.getByText("\uD83D\uDD0D")).toBeInTheDocument();
    // plan_route icon is world map
    expect(screen.getByText("\uD83D\uDDFA\uFE0F")).toBeInTheDocument();
  });

  it("shows the thinking label from dict when streaming with no steps", () => {
    render(<ThinkingProcess steps={[]} isStreaming={true} />);
    expect(
      screen.getByText(defaultDict.chat.thinking),
    ).toBeInTheDocument();
  });

  it("returns null when no steps and not streaming", () => {
    const { container } = render(
      <ThinkingProcess steps={[]} isStreaming={false} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("expands and collapses on button click", () => {
    const steps: StepEvent[] = [
      makeStep("resolve_anime", "done", "Found"),
      makeStep("search_bangumi", "done", "Searched"),
    ];
    // isStreaming=false => starts collapsed
    render(<ThinkingProcess steps={steps} isStreaming={false} />);

    // Collapsed: step labels from dict should not be visible (only summary)
    expect(screen.queryByText("\uD83D\uDD0D")).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByRole("button"));

    // Now tool icons should appear
    expect(screen.getByText("\uD83D\uDD0D")).toBeInTheDocument();
    expect(screen.getByText("\uD83D\uDCCD")).toBeInTheDocument();
  });

  it("shows failed count when steps have failures", () => {
    const steps: StepEvent[] = [
      makeStep("resolve_anime", "failed", "Error occurred"),
    ];
    render(<ThinkingProcess steps={steps} isStreaming={false} />);

    expect(screen.getByText("(1 failed)")).toBeInTheDocument();
  });
});
