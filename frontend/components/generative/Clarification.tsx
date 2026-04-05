"use client";

import { useDict } from "../../lib/i18n-context";

interface ClarificationProps {
  message: string;
  options?: string[];
  onSuggest?: (text: string) => void;
}

export default function Clarification({ message, options, onSuggest }: ClarificationProps) {
  const { clarification: t } = useDict();

  const hasOptions = options && options.length > 0;

  return (
    <div className="space-y-5 py-2">
      <p className="max-w-[65ch] text-sm font-light leading-loose text-[var(--color-fg)]">
        {message}
      </p>
      {hasOptions ? (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {options.map((option) => (
            <button
              key={option}
              onClick={() => onSuggest?.(option)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-xs font-light text-[var(--color-fg)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              {option}
            </button>
          ))}
        </div>
      ) : (
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
      )}
    </div>
  );
}
