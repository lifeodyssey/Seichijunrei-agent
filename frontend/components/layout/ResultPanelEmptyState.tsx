"use client";

import { useDict } from "../../lib/i18n-context";

interface ResultPanelEmptyStateProps {
  onSuggest?: (text: string) => void;
}

export function ResultPanelEmptyState({ onSuggest }: ResultPanelEmptyStateProps) {
  const { chat, clarification } = useDict();

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {/* Radial gradient background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 60% 70%, oklch(93% 0.025 240 / 0.18), transparent 70%)",
        }}
      />
      {/* Map watermark */}
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
  );
}
