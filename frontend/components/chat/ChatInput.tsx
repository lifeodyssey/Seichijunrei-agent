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

    // Parse the CSS maxHeight to pixels
    const computedMaxHeight = getComputedStyle(el).maxHeight;
    const maxHeightPx = computedMaxHeight === "none" ? Infinity : parseFloat(computedMaxHeight);

    // Clamp height to maxHeight
    const clampedHeight = Math.min(el.scrollHeight, maxHeightPx);
    el.style.height = `${clampedHeight}px`;

    // Toggle overflow when content exceeds maxHeight
    el.style.overflowY = el.scrollHeight > maxHeightPx ? "auto" : "hidden";
  }

  useEffect(adjustHeight, [text]);

  // Recalculate when the textarea width changes (panel open/close, divider drag)
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

  return (
    <div className="border-t border-[var(--color-border)] px-4 py-4">
      <div
        className="mx-auto flex w-full max-w-2xl items-end gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 shadow-sm transition focus-within:border-[var(--color-primary)]"
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
          className="flex-1 overflow-hidden resize-none bg-transparent text-sm font-light outline-none placeholder:text-[var(--color-muted-fg)] disabled:opacity-50"
          style={{ maxHeight: "8rem" }}
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          className="shrink-0 rounded-lg bg-[var(--color-primary)] px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-[var(--color-primary-fg)] transition hover:opacity-90 disabled:opacity-30"
          style={{ transitionDuration: "var(--duration-fast)" }}
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
            t.send
          )}
        </button>
      </div>
    </div>
  );
}