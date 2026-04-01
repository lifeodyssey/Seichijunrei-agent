"use client";

import { useState, type KeyboardEvent } from "react";
import { useDict } from "../../lib/i18n-context";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  prefill?: string;
}

export default function ChatInput({ onSend, disabled, prefill }: ChatInputProps) {
  const { chat: t } = useDict();
  const [text, setText] = useState(prefill ?? "");

  function handleSubmit() {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="border-t border-[var(--color-border)] px-4 py-4">
      <div className="mx-auto flex w-full max-w-2xl items-end gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 shadow-sm transition focus-within:border-[var(--color-primary)]"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        <textarea
          aria-label={t.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.placeholder}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-sm font-light outline-none placeholder:text-[var(--color-muted-fg)] disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          className="shrink-0 rounded-lg bg-[var(--color-primary)] px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-[var(--color-primary-fg)] transition hover:opacity-90 disabled:opacity-30"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          {t.send}
        </button>
      </div>
    </div>
  );
}
