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

export default function ThinkingProcess({
  steps,
  isStreaming,
}: ThinkingProcessProps) {
  const [expanded, setExpanded] = useState(isStreaming);
  const t = useDict();

  if (steps.length === 0) return null;

  const summary = steps
    .filter((s) => s.status === "done")
    .map((s) => s.observation || s.tool)
    .join(" \u2192 ");

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        <span className={isStreaming ? "animate-pulse" : ""}>{"\uD83E\uDDE0"}</span>
        <span>
          {isStreaming
            ? t.chat?.thinking || "Thinking..."
            : summary || t.chat?.thought_complete || "Done"}
        </span>
        <span className="text-[10px]">{expanded ? "\u25BC" : "\u25B6"}</span>
      </button>

      {expanded && (
        <div className="mt-1.5 ml-4 border-l-2 border-[var(--color-border)] pl-3 space-y-1.5">
          {steps.map((step, i) => {
            const icon = TOOL_ICONS[step.tool] || "\u2699\uFE0F";
            const isRunning = step.status === "running";

            return (
              <div key={`${step.tool}-${i}`} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <span>{icon}</span>
                  <span
                    className={
                      isRunning ? "text-[var(--color-primary)] animate-pulse" : ""
                    }
                  >
                    {step.thought || step.tool}
                  </span>
                  {!isRunning && (
                    <span className="text-green-600">{"\u2713"}</span>
                  )}
                </div>
                {step.observation && !isRunning && (
                  <div className="ml-5 text-[var(--color-muted)]">
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
