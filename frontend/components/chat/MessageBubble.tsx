"use client";

import { useState } from "react";
import type { ChatMessage } from "../../lib/types";
import IntentRenderer from "../generative/IntentRenderer";
import { submitFeedback } from "../../lib/api";

interface MessageBubbleProps {
  message: ChatMessage;
  onSuggest?: (text: string) => void;
}

export default function MessageBubble({ message, onSuggest }: MessageBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] rounded-2xl rounded-br-sm bg-[var(--color-primary)] px-4 py-2.5 text-sm text-[var(--color-primary-fg)]">
          {message.text}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-xs font-medium text-[var(--color-primary-fg)]">
        聖
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <p className="text-xs font-medium text-[var(--color-fg)]">聖地巡礼 AI</p>
        {message.loading ? (
          <div className="flex items-center gap-1 text-sm text-[var(--color-muted-fg)]">
            <span className="animate-pulse">考え中…</span>
          </div>
        ) : (
          <>
            {message.text && (
              <p className="text-sm text-[var(--color-fg)] leading-relaxed">
                {message.text}
              </p>
            )}
            {message.response && (
              <IntentRenderer response={message.response} onSuggest={onSuggest} />
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

function FeedbackButtons({ message }: { message: ChatMessage }) {
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
        ✓ フィードバック送信済み
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
            placeholder="何が問題でしたか？（任意）"
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-xs outline-none"
          />
          <button
            onClick={() => handleFeedback("bad")}
            className="rounded bg-[var(--color-secondary)] px-3 py-1 text-xs font-medium text-[var(--color-fg)]"
          >
            送信
          </button>
        </div>
      )}
    </div>
  );
}
