"use client";

import type { ChatMessage } from "../../lib/types";
import type { Dict, Locale } from "../../lib/i18n";
import WelcomeScreen from "./WelcomeScreen";
import MessageList from "./MessageList";
import ChatInput from "../chat/ChatInput";

interface ChatPanelProps {
  messages: ChatMessage[];
  sending: boolean;
  activeMessageId: string | null;
  dict: Dict;
  locale: Locale;
  onSend: (text: string) => void;
  onActivate: (messageId: string) => void;
  onOpenDrawer?: () => void;
  onSuggest?: (text: string) => void;
  isMobile?: boolean;
}

/**
 * 360px chat panel — shows WelcomeScreen when no messages, MessageList otherwise.
 * The WelcomeScreen is replaced by the message list after the first message is sent.
 */
export default function ChatPanel({
  messages,
  sending,
  activeMessageId,
  dict,
  locale,
  onSend,
  onActivate,
  onOpenDrawer,
  onSuggest,
  isMobile = false,
}: ChatPanelProps) {
  const isEmpty = messages.length === 0;

  return (
    <div className="flex min-h-0 w-[360px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg)]">
      {isEmpty ? (
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <WelcomeScreen onSend={onSend} dict={dict} locale={locale} />
        </div>
      ) : (
        <MessageList
          messages={messages}
          onActivate={onActivate}
          activeMessageId={activeMessageId}
          onOpenDrawer={isMobile ? onOpenDrawer : undefined}
          onSuggest={onSuggest ?? onSend}
        />
      )}
      <ChatInput
        onSend={onSend}
        disabled={sending}
        showQuickActions={isMobile && isEmpty}
      />
    </div>
  );
}
