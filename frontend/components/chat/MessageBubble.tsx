"use client";

import { useState } from "react";
import type { ChatMessage, RuntimeResponse } from "../../lib/types";
import { submitFeedback } from "../../lib/api";
import { useDict } from "../../lib/i18n-context";

interface MessageBubbleProps {
  message: ChatMessage;
  onActivate?: (messageId: string) => void;
  isActive?: boolean;
}

export default function MessageBubble({
  message,
  onActivate,
  isActive = false,
}: MessageBubbleProps) {
  const { chat: t } = useDict();

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] rounded-2xl rounded-br-sm bg-[var(--color-primary)] px-4 py-2.5 text-sm text-[var(--color-primary-fg)]">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-xs font-medium text-[var(--color-primary-fg)]">
        {t.bot_icon}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <p className="text-xs font-medium text-[var(--color-fg)]">{t.bot_name}</p>
        {message.loading ? (
          <ThinkingDots label={t.thinking} />
        ) : (
          <>
            {message.text && (
              <p className="text-sm leading-relaxed text-[var(--color-fg)]">
                {message.text}
              </p>
            )}
            {message.response && canShowAnchor(message.response) && (
              <ResultAnchor
                response={message.response}
                messageId={message.id}
                onActivate={onActivate}
                isActive={isActive}
              />
            )}
            {message.response && !message.loading && (
              <FeedbackButtons message={message} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ThinkingDots({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--color-muted-fg)]">
      <span className="sr-only">{label}</span>
      <span
        className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]"
        style={{ animation: "breathe 1.2s ease-in-out infinite" }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]"
        style={{ animation: "breathe 1.2s ease-in-out infinite 0.15s" }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]"
        style={{ animation: "breathe 1.2s ease-in-out infinite 0.3s" }}
      />
    </div>
  );
}

function canShowAnchor(response: RuntimeResponse): boolean {
  return response.intent !== "unclear" && response.ui?.component !== "Clarification";
}

function getAnchorLabel(response: RuntimeResponse): string {
  if (response.message) return response.message;

  switch (response.intent) {
    case "plan_route":
      return "ルートを見る";
    case "search_by_location":
      return "地図を見る";
    case "search_by_bangumi":
      return "結果を見る";
    case "general_qa":
      return "回答を見る";
    default:
      return "結果を見る";
  }
}

function ResultAnchor({
  response,
  messageId,
  onActivate,
  isActive,
}: {
  response: RuntimeResponse;
  messageId: string;
  onActivate?: (messageId: string) => void;
  isActive: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onActivate?.(messageId)}
      className={[
        "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition",
        isActive
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
          : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-fg)] hover:border-[var(--color-primary)]/60 hover:bg-[var(--color-muted)]",
      ].join(" ")}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-[var(--color-primary)]">◈</span>
        <span className="truncate">{getAnchorLabel(response)}</span>
      </span>
      <span className="shrink-0 text-xs text-[var(--color-muted-fg)]">→</span>
    </button>
  );
}

function FeedbackButtons({ message }: { message: ChatMessage }) {
  const { chat: t } = useDict();
  const [state, setState] = useState<"idle" | "commenting" | "submitted">("idle");
  const [comment, setComment] = useState("");

  async function handleFeedback(rating: "good" | "bad") {
    if (rating === "bad" && state === "idle") {
      setState("commenting");
      return;
    }

    try {
      await submitFeedback({
        session_id: message.response?.session_id,
        query_text: message.text,
        intent: message.response?.intent ?? "unknown",
        rating,
        comment: comment || undefined,
      });
      setState("submitted");
    } catch {
      // Silently fail — feedback is best-effort
    }
  }

  if (state === "submitted") {
    return (
      <p className="text-xs text-[var(--color-muted-fg)]">
        {t.feedback_sent}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <button
          onClick={() => handleFeedback("good")}
          className="rounded px-2 py-1 text-xs text-[var(--color-muted-fg)] transition hover:bg-[var(--color-secondary)] hover:text-[var(--color-fg)]"
          title="Good response"
        >
          👍
        </button>
        <button
          onClick={() => handleFeedback("bad")}
          className="rounded px-2 py-1 text-xs text-[var(--color-muted-fg)] transition hover:bg-[var(--color-secondary)] hover:text-[var(--color-fg)]"
          title="Bad response"
        >
          👎
        </button>
      </div>
      {state === "commenting" && (
        <div className="flex gap-2">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t.feedback_placeholder}
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-xs outline-none"
          />
          <button
            onClick={() => handleFeedback("bad")}
            className="rounded bg-[var(--color-secondary)] px-3 py-1 text-xs font-medium text-[var(--color-fg)]"
          >
            {t.send}
          </button>
        </div>
      )}
    </div>
  );
}
