"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { useSuggest } from "../../contexts/SuggestContext";
import MessageBubble from "./MessageBubble";

interface MessageListProps {
  messages: ChatMessage[];
  onActivate?: (messageId: string) => void;
  activeMessageId?: string | null;
  onOpenDrawer?: () => void;
}

export default function MessageList({
  messages,
  onActivate,
  activeMessageId,
  onOpenDrawer,
}: MessageListProps) {
  const { chat: t, clarification } = useDict();
  const onSuggest = useSuggest();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-8">
        <div
          className="w-full max-w-md rounded-[28px] border border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-card)_88%,white)] p-6 shadow-[0_24px_80px_oklch(20%_0.025_238_/_0.06)]"
          style={{ animation: "slide-up-fade 400ms var(--ease-out-quint) both" }}
        >
          <div className="space-y-3">
            <p className="font-[family-name:var(--app-font-display)] text-3xl text-[var(--color-fg)]">
              {t.welcome_title}
            </p>
            <p className="text-sm font-light leading-7 text-[var(--color-fg)]">
              {t.welcome_subtitle}
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-2.5">
            {clarification.suggestions.map((s, idx) => (
              <button
                key={s.label}
                type="button"
                onClick={() => onSuggest(s.query)}
                className="flex items-center justify-between rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-left text-sm font-light text-[var(--color-fg)] transition-colors hover:border-[var(--color-primary)]/50 hover:text-[var(--color-primary)]"
                style={{
                  transitionDuration: "var(--duration-fast)",
                  animation: `slide-up-fade 350ms var(--ease-out-quint) ${100 + idx * 60}ms both`,
                }}
              >
                <span>{s.label}</span>
                <span aria-hidden>→</span>
              </button>
            ))}
          </div>

          <p
            className="mt-5 text-xs font-light leading-6 text-[var(--color-muted-fg)]"
            style={{ animation: "slide-up-fade 350ms var(--ease-out-quint) 320ms both" }}
          >
            {t.welcome_helper}
          </p>
        </div>
      </div>
    );
  }

  const precedingUserText: string[] = [];
  let lastUserText = "";
  messages.forEach((m) => {
    precedingUserText.push(lastUserText);
    if (m.role === "user") lastUserText = m.text;
  });

  return (
    <div className="flex-1 overflow-y-auto py-6">
      <div className="mx-auto w-full max-w-2xl space-y-5 px-5">
        {messages.map((msg, idx) => (
          <div
            key={msg.id}
            style={{
              animation: `slide-up-fade 300ms var(--ease-out-quint) ${Math.min(idx * 40, 200)}ms both`,
            }}
          >
            <MessageBubble
              message={msg}
              userQuery={msg.role === "assistant" ? precedingUserText[idx] : undefined}
              onActivate={onActivate}
              isActive={msg.id === activeMessageId}
              onOpenDrawer={onOpenDrawer}
            />
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
