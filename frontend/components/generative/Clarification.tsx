"use client";

interface ClarificationProps {
  message: string;
  onSuggest?: (text: string) => void;
}

const SUGGESTIONS = [
  { label: "作品名で探す", query: "秒速5センチメートル の聖地を探して" },
  { label: "場所で探す", query: "宇治駅の近くにある聖地を教えて" },
  { label: "ルートを作る", query: "新宿から君の名は の聖地を回るルートを作って" },
];

export default function Clarification({ message, onSuggest }: ClarificationProps) {
  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
      <p className="text-sm text-[var(--color-fg)] leading-relaxed">{message}</p>
      <p className="text-xs text-[var(--color-muted-fg)]">例えば：</p>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
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
