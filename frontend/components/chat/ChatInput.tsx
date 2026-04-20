"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { useDict, useLocale } from "../../lib/i18n-context";
import { CHAT_INPUT_QUERIES } from "../../lib/quick-actions";
import LocationPrompt from "./LocationPrompt";

interface QuickAction {
  icon: string;
  label: string;
  query: string;
}

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  showQuickActions?: boolean;
  onLocationAcquired?: (lat: number, lng: number) => void;
}

export default function ChatInput({
  onSend,
  disabled,
  showQuickActions,
  onLocationAcquired,
}: ChatInputProps) {
  const dict = useDict();
  const { chat: t, landing_hero: lh } = dict;
  const locale = useLocale();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);

  const geoSupported =
    typeof navigator !== "undefined" && !!navigator.geolocation;

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

  function handleCoordsAcquired(lat: number, lng: number) {
    setShowLocationPrompt(false);
    onLocationAcquired?.(lat, lng);
  }

  function handleStationSubmit(station: string) {
    setShowLocationPrompt(false);
    onSend(station);
  }

  const queries = CHAT_INPUT_QUERIES[locale];
  const quickActions: QuickAction[] = [
    { icon: "\u2726", label: lh.feat_search, query: lh.chat_placeholder },
    { icon: "\u25CE", label: lh.feat_route, query: queries.route },
    { icon: "\u2197", label: lh.feat_series, query: queries.popular },
  ];

  return (
    <div className="px-4 py-4" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
      {showQuickActions && (
        <div className="mx-auto mb-2 flex max-w-[680px] gap-2 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => onSend(action.query)}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-sm text-[var(--color-fg)] transition-colors hover:border-[var(--color-primary)]/50 hover:text-[var(--color-primary)]"
              style={{ minHeight: "44px", transitionDuration: "var(--duration-fast)" }}
            >
              <span>{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
      {showLocationPrompt && (
        <LocationPrompt
          onCoords={handleCoordsAcquired}
          onStation={handleStationSubmit}
          onDismiss={() => setShowLocationPrompt(false)}
          dict={dict}
          locale={locale}
        />
      )}
      <div
        className="mx-auto flex w-full max-w-[680px] items-end gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 shadow-sm transition focus-within:border-[var(--color-primary)]"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        {geoSupported && (
          <button
            type="button"
            onClick={() => setShowLocationPrompt((v) => !v)}
            aria-label="location"
            className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full text-[var(--color-muted-fg)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-primary)]"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              <circle cx="12" cy="12" r="9" strokeDasharray="2 4" />
            </svg>
          </button>
        )}
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
          className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full transition-colors duration-150 disabled:bg-[var(--color-muted)] disabled:text-[var(--color-muted-fg)] bg-[var(--color-primary)] text-white hover:opacity-90"
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
