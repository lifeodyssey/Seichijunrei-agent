"use client";

import { useState } from "react";
import type { ChatMessage } from "../../lib/types";
import type { Dict, Locale } from "../../lib/i18n";
import WelcomeScreen from "./WelcomeScreen";
import MessageList from "./MessageList";
import ChatInput from "../chat/ChatInput";
import { cn } from "../../lib/utils";

interface ChatPanelProps {
  messages: ChatMessage[];
  sending: boolean;
  activeMessageId: string | null;
  dict: Dict;
  locale: Locale;
  onSend: (text: string, coords?: { lat: number; lng: number } | null) => void;
  onActivate: (messageId: string) => void;
  onOpenDrawer?: () => void;
  onSuggest?: (text: string) => void;
  isMobile?: boolean;
}

export default function ChatPanel({
  messages,
  sending,
  activeMessageId,
  dict,
  locale,
  onSend,
  onActivate,
  onOpenDrawer,
  isMobile = false,
}: ChatPanelProps) {
  const isEmpty = messages.length === 0;
  const [acquiredCoords, setAcquiredCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  function handleLocationAcquired(lat: number, lng: number) {
    setAcquiredCoords({ lat, lng });
  }

  function handleSend(text: string) {
    onSend(text, acquiredCoords);
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col border-[var(--color-border)] bg-[var(--color-bg)]",
        isMobile
          ? "h-full w-full border-r-0"
          : "w-[360px] shrink-0 border-r",
      )}>
      {isEmpty ? (
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <WelcomeScreen onSend={handleSend} dict={dict} locale={locale} />
        </div>
      ) : (
        <MessageList
          messages={messages}
          onActivate={onActivate}
          activeMessageId={activeMessageId}
          onOpenDrawer={isMobile ? onOpenDrawer : undefined}
        />
      )}
      <ChatInput
        onSend={handleSend}
        disabled={sending}
        showQuickActions={isMobile && isEmpty}
        onLocationAcquired={handleLocationAcquired}
      />
    </div>
  );
}
