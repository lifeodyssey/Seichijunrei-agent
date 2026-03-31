"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import MessageBubble from "./MessageBubble";

interface MessageListProps {
  messages: ChatMessage[];
  onActivate?: (messageId: string) => void;
  activeMessageId?: string | null;
}

export default function MessageList({
  messages,
  onActivate,
  activeMessageId,
}: MessageListProps) {
  const { chat: t } = useDict();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--color-muted-fg)]">
        <div className="text-center">
          <p className="text-lg font-medium">{t.welcome_title}</p>
          <p className="mt-1 text-sm">{t.welcome_subtitle}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          onActivate={onActivate}
          isActive={msg.id === activeMessageId}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}
