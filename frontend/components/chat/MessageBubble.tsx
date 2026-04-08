"use client";

import { useState } from "react";
import type { ChatMessage, ErrorCode, RouteData, RuntimeResponse } from "../../lib/types";
import ThinkingProcess from "./ThinkingProcess";
import { isQAData, isRouteData, isSearchData } from "../../lib/types";
import { isVisualResponse } from "../generative/registry";
import { submitFeedback } from "../../lib/api";
import { useDict } from "../../lib/i18n-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface MessageBubbleProps {
  message: ChatMessage;
  userQuery?: string;
  onActivate?: (messageId: string) => void;
  isActive?: boolean;
  onOpenDrawer?: () => void;
  onRetry?: () => void;
}

export default function MessageBubble({
  message,
  userQuery,
  onActivate,
  isActive = false,
  onOpenDrawer,
  onRetry,
}: MessageBubbleProps) {
  const dict = useDict();
  const t = dict.chat;

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
      className="group flex flex-col gap-2.5"
      style={{ animation: "slide-up-fade 300ms var(--ease-out-quint) both" }}
    >
      <p className="text-[8px] font-medium uppercase tracking-widest text-[var(--color-muted-fg)] opacity-40">
        {t.bot_name}
      </p>

      {message.loading ? (
        <ThinkingProcess steps={message.steps ?? []} isStreaming={true} />
      ) : message.errorCode ? (
        <ErrorDisplay errorCode={message.errorCode} errorDict={dict.error} onRetry={onRetry} />
      ) : (
        <>
          {message.text && (
            <p className="text-sm font-light leading-loose text-[var(--color-fg)]">
              {message.text}
            </p>
          )}
          {message.response && canShowAnchor(message.response) && (
            <>
              <InlineSummaryCard
                response={message.response}
                messageId={message.id}
                onActivate={onActivate}
                onOpenDrawer={onOpenDrawer}
                cardDict={dict.card}
              />
              <ResultAnchor
                label={t.anchor_results.replace(
                  "{count}",
                  String(getResultCount(message.response)),
                )}
                subtitle={t.tap_to_view}
                messageId={message.id}
                onActivate={onActivate}
                isActive={isActive}
                onOpenDrawer={onOpenDrawer}
              />
            </>
          )}
          {message.response && !message.loading && (
            <FeedbackButtons message={message} userQuery={userQuery ?? ""} />
          )}
        </>
      )}
    </div>
  );
}

function mapErrorToKey(code: ErrorCode): "stream" | "timeout" | "rate_limit" | "generic" {
  switch (code) {
    case "stream_error": return "stream";
    case "timeout": return "timeout";
    case "rate_limit": return "rate_limit";
    default: return "generic";
  }
}

function ErrorDisplay({
  errorCode,
  errorDict,
  onRetry,
}: {
  errorCode: ErrorCode;
  errorDict: { stream: string; timeout: string; rate_limit: string; generic: string; retry: string };
  onRetry?: () => void;
}) {
  const key = mapErrorToKey(errorCode);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-red-600">{errorDict[key]}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-[var(--color-primary)] hover:underline text-sm"
        >
          {errorDict.retry}
        </button>
      )}
    </div>
  );
}
function canShowAnchor(response: RuntimeResponse): boolean {
  return isVisualResponse(response);
}

function getResultCount(response: RuntimeResponse): number {
  const data = response.data;
  if (isQAData(data)) return 1;
  if (isRouteData(data)) return data.route.point_count ?? data.route.ordered_points.length;
  if (isSearchData(data)) return data.results.row_count ?? data.results.rows.length;
  return 0;
}

function InlineSummaryCard({
  response,
  messageId,
  onActivate,
  onOpenDrawer,
  cardDict,
}: {
  response: RuntimeResponse;
  messageId: string;
  onActivate?: (messageId: string) => void;
  onOpenDrawer?: () => void;
  cardDict: { view_details: string; view_full_route: string; spots_count: string };
}) {
  const inlineData = response.data;

  // Search result inline card
  if (isSearchData(inlineData)) {
    const data = inlineData;
    const rows = data.results.rows;
    if (rows.length === 0) return null;

    const animeTitle = rows[0]?.title_cn || rows[0]?.title || "";
    const count = data.results.row_count ?? rows.length;
    const thumbnails = rows.filter((r) => r.screenshot_url).slice(0, 3);

    return (
      <Card size="sm" className="w-fit max-w-[280px] bg-[var(--color-card)]">
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)] text-sm text-white">{"\uD83D\uDCCD"}</span>
            <p className="text-xs font-medium text-[var(--color-fg)]">
              {animeTitle} — <span className="text-[var(--color-muted-fg)]">{cardDict.spots_count.replace("{count}", String(count))}</span>
            </p>
          </div>
          {thumbnails.length > 0 && (
            <div className="flex gap-1">
              {thumbnails.map((point) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={point.id}
                  src={point.screenshot_url!}
                  alt={point.name_cn || point.name}
                  className="h-12 w-16 rounded-sm object-cover"
                  loading="lazy"
                />
              ))}
            </div>
          )}
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              onActivate?.(messageId);
              onOpenDrawer?.();
            }}
          >
            {cardDict.view_details} →
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Route result inline card
  if ("route" in inlineData) {
    const routeData = inlineData as unknown as RouteData;
    const route = routeData.route;
    const spotCount = route.point_count ?? route.ordered_points.length;
    const itinerary = route.timed_itinerary;
    const distance = itinerary
      ? `${(itinerary.total_distance_m / 1000).toFixed(1)} km`
      : "";
    const duration = itinerary ? `${itinerary.total_minutes}min` : "";
    const routeTitle =
      route.ordered_points[0]?.title_cn ||
      route.ordered_points[0]?.title ||
      "";

    return (
      <Card size="sm" className="w-fit max-w-[320px] bg-[var(--color-card)]">
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">🗺️</span>
            <span className="text-xs font-medium text-[var(--color-fg)]">
              {routeTitle}
            </span>
          </div>
          <p className="text-[11px] text-[var(--color-muted-fg)]">
            {spotCount} spots{distance ? ` · ${distance}` : ""}{duration ? ` · ~${duration}` : ""}
          </p>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              onActivate?.(messageId);
              onOpenDrawer?.();
            }}
          >
            {cardDict.view_full_route} →
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null;
}

function ResultAnchor({
  label,
  subtitle,
  messageId,
  onActivate,
  isActive,
  onOpenDrawer,
}: {
  label: string;
  subtitle: string;
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
        "group/anchor flex w-full max-w-[320px] items-center gap-3 rounded-xl border p-3 text-left transition-all",
        isActive
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 shadow-sm"
          : "border-[var(--color-border)] bg-[var(--color-card)] hover:border-[var(--color-primary)]/60 hover:-translate-y-0.5 hover:shadow-sm",
      ].join(" ")}
      style={{ transitionDuration: "var(--duration-fast)", transitionTimingFunction: "var(--ease-out-quint)" }}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)] text-sm text-white">
        {"\uD83D\uDCCD"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-[var(--color-fg)]">{label}</span>
        <span className="text-[11px] text-[var(--color-muted-fg)]">{subtitle}</span>
      </span>
      <span className="shrink-0 text-sm text-[var(--color-muted-fg)] transition-transform group-hover/anchor:translate-x-0.5" style={{ transitionDuration: "var(--duration-fast)" }}>
        {"\u203A"}
      </span>
    </button>
  );
}

function FeedbackButtons({ message, userQuery }: { message: ChatMessage; userQuery: string }) {
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
        query_text: userQuery,
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
      <div className="flex gap-0.5 opacity-50 transition-opacity md:opacity-0 md:group-hover:opacity-50 md:group-focus-within:opacity-50 hover:!opacity-100" style={{ transitionDuration: "var(--duration-fast)" }}>
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
