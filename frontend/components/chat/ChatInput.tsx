"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { useDict } from "../../lib/i18n-context";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const { chat: t } = useDict();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function adjustHeight() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";

    const maxHeightPx = 144; // ~6 rows
    const clampedHeight = Math.min(el.scrollHeight, maxHeightPx);
    el.style.height = `${clampedHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeightPx ? "auto" : "hidden";
  }

  useEffect(adjustHeight, [text]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(adjustHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  const hasText = text.trim().length > 0;

  return (
    <div className="px-4 py-4">
      <div
        className="mx-auto flex w-full max-w-[680px] items-end gap-2 rounded-2xl border border-[var(--color-border)] bg-white p-3 shadow-sm transition focus-within:border-[var(--color-primary)]"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        <textarea
          ref={textareaRef}
          aria-label={t.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.placeholder}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-sm font-light leading-relaxed outline-none placeholder:text-[var(--color-muted-fg)] disabled:opacity-50"
          style={{ minHeight: "24px", maxHeight: "144px" }}
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !hasText}
          className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full transition-colors duration-150 disabled:bg-gray-200 disabled:text-gray-400 bg-[var(--color-primary)] text-white hover:opacity-90"
          aria-label={t.send}
        >
          {disabled ? (
            <span className="flex items-center gap-0.5">
              {([0, 0.2, 0.4] as const).map((delay) => (
                <span
                  key={delay}
                  className="inline-block h-1 w-1 rounded-full bg-current"
                  style={{
                    animation: "breathe 1.2s ease-in-out infinite",
                    animationDelay: `${delay}s`,
                  }}
                />
              ))}
            </span>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 16V4M10 4l-5 5M10 4l5 5" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
