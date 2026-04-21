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

/**
 * Chat input — editorial search bar feel, not a support widget.
 *
 * Design direction: clean single-line input with a subtle border.
 * Send button appears only when there's content (progressive disclosure).
 * Location button is secondary — small icon, not prominent.
 * On the welcome screen this is the conversational entry point.
 */
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
    const maxHeightPx = 120;
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

  // Locale-aware placeholder
  const placeholder =
    locale === "zh"
      ? "输入动漫名称，或描述你的巡礼计划…"
      : locale === "en"
        ? "Type an anime name, or describe your trip…"
        : "アニメ名を入力、または旅の計画を…";

  return (
    <div
      className="px-4 pb-4 pt-2"
      style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
    >
      {/* Mobile quick actions */}
      {showQuickActions && (
        <div
          className="mx-auto mb-2 flex max-w-[520px] gap-2 overflow-x-auto pb-1"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => onSend(action.query)}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-sm text-[var(--color-fg)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
              style={{
                minHeight: "44px",
                transitionDuration: "var(--duration-fast)",
              }}
            >
              <span>{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Location prompt overlay */}
      {showLocationPrompt && (
        <LocationPrompt
          onCoords={handleCoordsAcquired}
          onStation={handleStationSubmit}
          onDismiss={() => setShowLocationPrompt(false)}
          dict={dict}
          locale={locale}
        />
      )}

      {/* Input bar — clean, editorial, not a chat widget */}
      <div
        className="mx-auto flex w-full max-w-[520px] items-end gap-2 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 transition-colors focus-within:border-[var(--color-primary)]"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        {/* Location — subtle, secondary */}
        {geoSupported && (
          <button
            type="button"
            onClick={() => setShowLocationPrompt((v) => !v)}
            aria-label="location"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-[var(--color-muted-fg)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-primary)]"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </button>
        )}

        {/* Textarea — auto-grows, single line default */}
        <textarea
          ref={textareaRef}
          aria-label={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none focus:outline-none focus-visible:outline-none placeholder:text-[var(--color-muted-fg)] disabled:opacity-50"
          style={{ minHeight: "24px", maxHeight: "120px" }}
        />

        {/* Send — appears only when content exists or sending */}
        <button
          onClick={handleSubmit}
          disabled={disabled || !hasText}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-md)] transition-all duration-150"
          style={{
            opacity: hasText || disabled ? 1 : 0.3,
            background: hasText
              ? "var(--color-primary)"
              : "var(--color-muted)",
            color: hasText
              ? "white"
              : "var(--color-muted-fg)",
          }}
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
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
