"use client";

import type { RuntimeResponse } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import GenerativeUIRenderer from "../generative/GenerativeUIRenderer";

interface ResultPanelProps {
  activeResponse: RuntimeResponse | null;
  onSuggest?: (text: string) => void;
}

export default function ResultPanel({ activeResponse, onSuggest }: ResultPanelProps) {
  const { chat } = useDict();

  if (!activeResponse) {
    return (
      <section className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-[var(--color-bg)]">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(212, 149, 74, 0.18), transparent 30%), linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)",
            backgroundSize: "auto, 48px 48px, 48px 48px",
            backgroundPosition: "0 0, 0 0, 0 0",
          }}
        />
        <div className="relative flex flex-col items-center gap-3 px-8 text-center">
          <div className="rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-1 text-[10px] uppercase tracking-[0.3em] text-[var(--color-muted-fg)]">
            Result Panel
          </div>
          <p className="font-[family-name:var(--app-font-display)] text-2xl text-[var(--color-fg)]">
            {chat.welcome_title}
          </p>
          <p className="max-w-sm text-sm leading-7 text-[var(--color-muted-fg)]">
            {chat.welcome_subtitle}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
      <div className="flex-1 overflow-y-auto p-6">
        <GenerativeUIRenderer response={activeResponse} onSuggest={onSuggest} />
      </div>
    </section>
  );
}
