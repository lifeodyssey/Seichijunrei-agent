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
}

export default function MessageList({
  messages,
  onActivate,
  activeMessageId,
  onOpenDrawer,
}: MessageListProps) {
  const { chat: t } = useDict();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs font-light text-[var(--color-muted-fg)] opacity-50">
          {t.placeholder}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-6">
      <div className="mx-auto w-full max-w-2xl space-y-5 px-5">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
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
