"use client";

import { useState } from "react";
import type { ChatMessage, RuntimeResponse } from "../../lib/types";
import { submitFeedback } from "../../lib/api";
import { useDict } from "../../lib/i18n-context";

interface MessageBubbleProps {
  message: ChatMessage;
  onActivate?: (messageId: string) => void;
  isActive?: boolean;
  onOpenDrawer?: () => void;
}

export default function MessageBubble({
  message,
  onActivate,
  isActive = false,
  onOpenDrawer,
}: MessageBubbleProps) {
  const { chat: t } = useDict();

  if (message.role === "user") {
    return (
      <div
        className="flex justify-end"
        style={{ animation: "slide-up-fade 300ms var(--ease-out-quint) both" }}
      >
        <div className="max-w-[70%] rounded-xl bg-[var(--color-primary)] px-4 py-2.5 text-sm font-normal text-[var(--color-primary-fg)]">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-2.5"
      style={{ animation: "slide-up-fade 300ms var(--ease-out-quint) both" }}
    >
      {/* Bot label — editorial, no avatar circle */}
      <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-muted-fg)]">
        {t.bot_name}
      </p>

      {message.loading ? (
        <ThinkingBar />
      ) : (
        <>
          {message.text && (
            <p className="text-sm font-light leading-loose text-[var(--color-fg)]">
              {message.text}
            </p>
          )}
          {message.response && canShowAnchor(message.response) && (
            <ResultAnchor
              label={t.anchor_results.replace(
                "{count}",
                String(getResultCount(message.response)),
              )}
              count={getResultCount(message.response)}
              messageId={message.id}
              onActivate={onActivate}
              isActive={isActive}
              onOpenDrawer={onOpenDrawer}
            />
          )}
          {message.response && !message.loading && (
            <FeedbackButtons message={message} />
          )}
        </>
      )}
    </div>
  );
}

function ThinkingBar() {
  return (
    <div className="relative h-px w-16 overflow-hidden bg-[var(--color-border)]">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--color-primary), transparent)",
          animation: "shimmer 1.4s ease-in-out infinite",
        }}
      />
    </div>
  );
}

function canShowAnchor(response: RuntimeResponse): boolean {
  return response.intent !== "unclear" && response.ui?.component !== "Clarification";
}

function getResultCount(response: RuntimeResponse): number {
  const data = response.data;

  if ("results" in data && !("route" in data)) {
    return data.results.row_count ?? data.results.rows.length;
  }
  if ("route" in data) {
    return data.route.point_count ?? data.route.ordered_points.length;
  }
  if ("confidence" in data) {
    return 1;
  }

  return 0;
}

function ResultAnchor({
  label,
  count,
  messageId,
  onActivate,
  isActive,
  onOpenDrawer,
}: {
  label: string;
  count: number;
  messageId: string;
  onActivate?: (messageId: string) => void;
  isActive: boolean;
  onOpenDrawer?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onActivate?.(messageId);
        onOpenDrawer?.();
      }}
      className={[
        "flex w-fit items-center gap-2 border px-3 py-1.5 text-xs transition",
        isActive
          ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
          : "border-[var(--color-border)] bg-transparent text-[var(--color-muted-fg)] hover:border-[var(--color-primary)]/60 hover:text-[var(--color-fg)]",
      ].join(" ")}
      style={{ transitionDuration: "var(--duration-fast)", transitionTimingFunction: "var(--ease-out-quint)" }}
    >
      <span className={isActive ? "text-[var(--color-primary-fg)]" : "text-[var(--color-primary)]"}>
        ◈
      </span>
      <span>{label}</span>
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
      <p className="text-[10px] text-[var(--color-muted-fg)] opacity-60">
        {t.feedback_sent}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-0.5 opacity-40 hover:opacity-100 transition-opacity" style={{ transitionDuration: "var(--duration-fast)" }}>
        <button
          aria-label={t.feedback_good_title}
          onClick={() => handleFeedback("good")}
          className="rounded px-1.5 py-0.5 text-[11px] text-[var(--color-muted-fg)] transition hover:text-[var(--color-fg)]"
          title={t.feedback_good_title}
        >
          👍
        </button>
        <button
          aria-label={t.feedback_bad_title}
          onClick={() => handleFeedback("bad")}
          className="rounded px-1.5 py-0.5 text-[11px] text-[var(--color-muted-fg)] transition hover:text-[var(--color-fg)]"
          title={t.feedback_bad_title}
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
            className="flex-1 border-b border-[var(--color-border)] bg-transparent px-0 py-1 text-xs outline-none focus:border-[var(--color-primary)]"
          />
          <button
            onClick={() => handleFeedback("bad")}
            className="text-xs font-medium text-[var(--color-primary)]"
          >
            {t.send}
          </button>
        </div>
      )}
    </div>
  );
}
