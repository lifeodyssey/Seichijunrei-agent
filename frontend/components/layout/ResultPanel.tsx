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
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "url(/empty-map.svg)",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-100"
          style={{
            backgroundImage:
              "radial-gradient(circle at 18% 22%, rgba(212, 149, 74, 0.22), transparent 46%), radial-gradient(circle at 68% 56%, rgba(212, 149, 74, 0.10), transparent 52%), radial-gradient(circle at 50% 80%, rgba(0, 0, 0, 0.72), transparent 55%)",
          }}
        />
        <div className="relative flex flex-col items-center gap-3 px-8 text-center">
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
