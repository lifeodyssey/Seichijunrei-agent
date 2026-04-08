"use client";

import type { RuntimeResponse } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";
import GenerativeUIRenderer from "../generative/GenerativeUIRenderer";
import SelectionBar from "../generative/SelectionBar";

interface ResultPanelProps {
  activeResponse: RuntimeResponse | null;
  onSuggest?: (text: string) => void;
  onRouteSelected?: (origin: string) => void;
  defaultOrigin?: string;
  loading?: boolean;
}

export default function ResultPanel({
  activeResponse,
  onSuggest,
  onRouteSelected,
  defaultOrigin,
  loading,
}: ResultPanelProps) {
  const { chat, clarification } = useDict();
  const { selectedIds, clear } = usePointSelectionContext();

  const selectionBar = selectedIds.size > 0 ? (
    <SelectionBar
      count={selectedIds.size}
      defaultOrigin={defaultOrigin ?? ""}
      onRoute={(origin) => onRouteSelected?.(origin)}
      onClear={clear}
      disabled={loading}
    />
  ) : null;

  if (!activeResponse) {
    if (loading) {
      return (
        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
          {selectionBar}
          <div className="flex w-full flex-1 flex-col gap-4 p-6">
            {[80, 55, 65].map((w) => (
              <div
                key={w}
                className="h-3 rounded-sm bg-[var(--color-muted)]"
                style={{
                  width: `${w}%`,
                  animation: "pulse-skeleton 1.6s ease-in-out infinite",
                }}
              />
            ))}
            <div
              className="mt-2 h-32 w-full rounded-sm bg-[var(--color-muted)]"
              style={{ animation: "pulse-skeleton 1.6s ease-in-out infinite 0.2s" }}
            />
          </div>
        </section>
      );
    }

    return (
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
        {selectionBar}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage: "url(/empty-map.svg)",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />

          <div className="relative flex flex-1 flex-col justify-end pb-16 pl-10 pr-8">
            <div className="relative mb-6 select-none leading-[0.85]">
              <div
                className="font-[family-name:var(--app-font-display)] font-bold"
                style={{
                  fontSize: "clamp(5rem, 12vw, 9rem)",
                  color: "color-mix(in oklch, var(--color-fg) 9%, transparent)",
                }}
              >
                <div>聖地</div>
                <div>巡礼</div>
              </div>
              <div
                className="absolute left-0 top-0 font-[family-name:var(--app-font-display)] font-bold text-[var(--color-primary)]"
                style={{ fontSize: "clamp(5rem, 12vw, 9rem)", lineHeight: "0.85" }}
              >
                聖
              </div>
            </div>

            <div className="mb-5 w-12 border-t border-[var(--color-border)]" />

            <p className="mb-8 max-w-xs text-sm font-light leading-relaxed text-[var(--color-muted-fg)]">
              {chat.welcome_subtitle}
            </p>

            <div className="flex flex-col gap-1.5">
              {clarification.suggestions.map((s) => (
                <button
                  key={s.label}
                  onClick={() => onSuggest?.(s.query)}
                  className="w-fit text-left text-xs font-light text-[var(--color-muted-fg)] transition-colors hover:text-[var(--color-primary)]"
                  style={{ transitionDuration: "var(--duration-fast)" }}
                >
                  {s.label} →
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]"
      style={{ animation: "slide-in-right 0.3s ease-out" }}
    >
      {selectionBar}
      <div className="flex-1 overflow-y-auto p-6">
        <GenerativeUIRenderer response={activeResponse} onSuggest={onSuggest} />
      </div>
    </section>
  );
}
