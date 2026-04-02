"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import MessageBubble from "./MessageBubble";

interface MessageListProps {
  messages: ChatMessage[];
  onActivate?: (messageId: string) => void;
  activeMessageId?: string | null;
  onOpenDrawer?: () => void;
  onSuggest?: (text: string) => void;
}

export default function MessageList({
  messages,
  onActivate,
  activeMessageId,
  onOpenDrawer,
  onSuggest,
}: MessageListProps) {
  const { chat: t, clarification } = useDict();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6">
        <p className="text-xs font-light text-[var(--color-muted-fg)] opacity-50">
          {t.placeholder}
        </p>
        <div className="flex flex-col items-center gap-2">
          {clarification.suggestions.map((s) => (
            <button
              key={s.label}
              onClick={() => onSuggest?.(s.query)}
              className="text-xs font-light text-[var(--color-muted-fg)] transition-colors hover:text-[var(--color-primary)]"
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              {s.label} →
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Pre-pass: map each index to the text of the most recent preceding user message
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
          <MessageBubble
            key={msg.id}
            message={msg}
            userQuery={msg.role === "assistant" ? precedingUserText[idx] : undefined}
            onActivate={onActivate}
            isActive={msg.id === activeMessageId}
            onOpenDrawer={onOpenDrawer}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
