"use client";

import { useState, type KeyboardEvent } from "react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  prefill?: string;
}

export default function ChatInput({ onSend, disabled, prefill }: ChatInputProps) {
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
    <div className="flex items-center gap-3 border-t border-[var(--color-border)] px-6 py-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="聖地を探す・ルートを計画する…"
        rows={1}
        disabled={disabled}
        className="flex-1 resize-none rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !text.trim()}
        className="rounded-full bg-[var(--color-primary)] px-5 py-2.5 text-sm font-medium text-[var(--color-primary-fg)] disabled:opacity-40"
      >
        送信
      </button>
    </div>
  );
}
