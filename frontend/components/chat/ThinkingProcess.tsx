"use client";

import { useState } from "react";
import type { StepEvent } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";

interface ThinkingProcessProps {
  steps: StepEvent[];
  isStreaming: boolean;
}

const TOOL_ICONS: Record<string, string> = {
  resolve_anime: "\uD83D\uDD0D",
  search_bangumi: "\uD83D\uDCCD",
  search_nearby: "\uD83D\uDCCD",
  plan_route: "\uD83D\uDDFA\uFE0F",
  plan_selected: "\uD83D\uDDFA\uFE0F",
  greet_user: "\uD83D\uDC4B",
  answer_question: "\uD83D\uDCAC",
  clarify: "\u2753",
};

const STATUS_INDICATOR: Record<string, string> = {
  running: "\u23F3",
  done: "\u2713",
  failed: "\u2717",
};

export default function ThinkingProcess({
  steps,
  isStreaming,
}: ThinkingProcessProps) {
  const [expanded, setExpanded] = useState(isStreaming);
  const t = useDict();

  if (steps.length === 0) {
    if (!isStreaming) return null;
    return (
      <div className="mb-2 flex items-center gap-1.5 text-xs text-[var(--color-muted-fg)]">
        <span className="animate-pulse">{"\uD83E\uDDE0"}</span>
        <span>{t.chat?.thinking || "Thinking..."}</span>
      </div>
    );
  }

  // Latest thought from the most recent step
  const latestThought = [...steps].reverse().find((s) => s.thought)?.thought;

  // Summary for collapsed state
  const completedSteps = steps.filter((s) => s.status === "done");
  const failedSteps = steps.filter((s) => s.status === "failed");
  const summary = completedSteps
    .map((s) => s.observation || s.tool)
    .join(" \u2192 ");

  return (
    <div className="mb-2">
      {/* Main thought line — natural language from planner */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-[var(--color-muted-fg)] hover:text-[var(--color-fg)] transition-colors"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        <span className={isStreaming ? "animate-pulse" : ""}>
          {"\uD83E\uDDE0"}
        </span>
        <span>
          {isStreaming
            ? latestThought || t.chat?.thinking || "Thinking..."
            : summary || t.chat?.thought_complete || "Done"}
        </span>
        {failedSteps.length > 0 && !isStreaming && (
          <span
            className="text-[10px]"
            style={{ color: "var(--color-error-fg)" }}
          >
            ({failedSteps.length} failed)
          </span>
        )}
        <span className="text-[10px]">{expanded ? "\u25BC" : "\u25B6"}</span>
      </button>

      {/* Expanded: tool steps as compact sub-items */}
      {expanded && (
        <div className="mt-1.5 ml-4 border-l-2 border-[var(--color-border)] pl-3 space-y-1">
          {steps.map((step, i) => {
            const icon = TOOL_ICONS[step.tool] || "\u2699\uFE0F";
            const isFailed = step.status === "failed";
            const isRunning = step.status === "running";

            return (
              <div key={`${step.tool}-${i}`} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-4 text-center">{icon}</span>
                  <span
                    className={
                      isRunning
                        ? "text-[var(--color-primary)] animate-pulse"
                        : "text-[var(--color-muted-fg)]"
                    }
                    style={
                      isFailed
                        ? { color: "var(--color-error-fg)" }
                        : undefined
                    }
                  >
                    {step.thought || step.tool}
                  </span>
                  <span
                    className={isRunning ? "text-[var(--color-primary)]" : ""}
                    style={{
                      color: isFailed
                        ? "var(--color-error-fg)"
                        : isRunning
                          ? undefined
                          : "var(--color-success-fg)",
                    }}
                  >
                    {STATUS_INDICATOR[step.status] || ""}
                  </span>
                </div>
                {step.observation && !isRunning && (
                  <div
                    className="ml-5 text-[var(--color-muted-fg)]"
                    style={
                      isFailed
                        ? { color: "var(--color-error-fg)" }
                        : undefined
                    }
                  >
                    {"\u2192"} {step.observation}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
