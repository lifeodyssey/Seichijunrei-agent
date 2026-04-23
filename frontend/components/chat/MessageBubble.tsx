"use client";

import type { ChatMessage, ErrorCode, RuntimeResponse } from "../../lib/types";
import { isQAData, isRouteData, isSearchData, isClarifyData } from "../../lib/types";
import { isVisualResponse } from "../generative/registry";
import { useDict } from "../../lib/i18n-context";
import ThinkingProcess from "./ThinkingProcess";
import ClarificationBubble from "./ClarificationBubble";
import NearbyBubbleWrapper from "./NearbyBubbleWrapper";
import ResultAnchor from "./ResultAnchor";
import FeedbackButtons from "./FeedbackButtons";

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

  const isClarification =
    message.response != null && isClarifyData(message.response.data);
  const isNearby =
    message.response != null &&
    message.response.intent === "search_nearby" &&
    isSearchData(message.response.data);

  return (
    <div
      className="group flex flex-col gap-2.5"
      style={{ animation: "slide-up-fade 300ms var(--ease-out-quint) both" }}
      aria-live={message.loading ? "polite" : undefined}
    >
      <p className="text-[8px] font-medium uppercase tracking-widest text-[var(--color-muted-fg)] opacity-40">
        {t.bot_name}
      </p>

      {message.loading ? (
        <ThinkingProcess steps={message.steps ?? []} isStreaming={true} />
      ) : message.errorCode ? (
        <ErrorDisplay errorCode={message.errorCode} errorDict={dict.error} onRetry={onRetry} />
      ) : isNearby && message.response != null ? (
        <NearbyBubbleWrapper response={message.response} />
      ) : isClarification && message.response != null ? (
        <ClarificationBubble response={message.response} />
      ) : (
        <>
          {message.text && (
            <p className="text-sm font-light leading-loose text-[var(--color-fg)]">
              {message.text}
            </p>
          )}
          {message.response && isVisualResponse(message.response) && (
            <ResultAnchor
              label={t.anchor_results.replace("{count}", String(getResultCount(message.response)))}
              subtitle={t.tap_to_view}
              messageId={message.id}
              onActivate={onActivate}
              isActive={isActive}
              onOpenDrawer={onOpenDrawer}
            />
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
      <span className="text-[var(--color-error-fg)]">{errorDict[key]}</span>
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

function getResultCount(response: RuntimeResponse): number {
  const data = response.data;
  if (data == null) return 0;
  if (isQAData(data)) return 1;
  if (isRouteData(data)) return data.route.point_count ?? data.route.ordered_points.length;
  if (isSearchData(data)) return data.results.row_count ?? data.results.rows.length;
  return 0;
}
