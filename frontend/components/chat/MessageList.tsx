"use client";

import type { ChatMessage } from "../../lib/types";
import MessageBubble from "./MessageBubble";
import { useEffect, useRef } from "react";

interface MessageListProps {
  messages: ChatMessage[];
  onSuggest?: (text: string) => void;
}

export default function MessageList({ messages, onSuggest }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--color-muted-fg)]">
        <div className="text-center">
          <p className="text-lg font-medium">聖地巡礼 AI</p>
          <p className="mt-1 text-sm">アニメの聖地を探したり、巡礼ルートを計画できます</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} onSuggest={onSuggest} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
