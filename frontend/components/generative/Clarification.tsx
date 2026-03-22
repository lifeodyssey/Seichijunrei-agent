"use client";

import { useDict } from "../../lib/i18n-context";

interface ClarificationProps {
  message: string;
  onSuggest?: (text: string) => void;
}

export default function Clarification({ message, onSuggest }: ClarificationProps) {
  const { clarification: t } = useDict();

  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
      <p className="text-sm text-[var(--color-fg)] leading-relaxed">{message}</p>
      <p className="text-xs text-[var(--color-muted-fg)]">{t.examples_label}</p>
      <div className="flex flex-wrap gap-2">
        {t.suggestions.map((s) => (
          <button
            key={s.label}
            onClick={() => onSuggest?.(s.query)}
            className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-secondary)]"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
