"use client";

import { useDict } from "../../lib/i18n-context";

interface ClarificationProps {
  message: string;
  onSuggest?: (text: string) => void;
}

export default function Clarification({ message, onSuggest }: ClarificationProps) {
  const { clarification: t } = useDict();

  return (
    <div className="space-y-5 py-2">
      <p className="max-w-[65ch] text-sm font-light leading-loose text-[var(--color-fg)]">
        {message}
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {t.suggestions.map((s) => (
          <button
            key={s.label}
            onClick={() => onSuggest?.(s.query)}
            className="text-xs font-light text-[var(--color-primary)] underline-offset-2 transition hover:underline"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            {s.label} →
          </button>
        ))}
      </div>
    </div>
  );
}
