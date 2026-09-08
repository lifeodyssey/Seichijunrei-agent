import type { ChatStatus, UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import type { ChatTimingReporter } from "./telemetry";
import { recordChatTiming } from "./telemetry";

interface Tracker {
  startedAt: number;
  firstToken: boolean;
  baselineEvents: number;
}

type TimingMessage = UIMessage<unknown, { response: unknown }>;
type TimingPart = TimingMessage["parts"][number];

function onSubmitted(ref: Tracker, eventCount: number): void {
  ref.startedAt = Date.now();
  ref.firstToken = false;
  ref.baselineEvents = eventCount;
}

function reportFirstToken(ref: Tracker, report: ChatTimingReporter): void {
  if (ref.firstToken) return;
  ref.firstToken = true;
  report({ kind: "first_token", ms: Date.now() - ref.startedAt });
}

function settleTurn(ref: Tracker, report: ChatTimingReporter): number {
  const ms = Date.now() - ref.startedAt;
  ref.startedAt = 0;
  report({ kind: "turn", ms });
  return ms;
}

/** One status transition → the settled turn duration, or undefined mid-turn. */
function stepTiming(status: ChatStatus, eventCount: number, ref: Tracker, report: ChatTimingReporter): number | undefined {
  if (status === "submitted") { onSubmitted(ref, eventCount); return undefined; }
  if (ref.startedAt === 0) return undefined;
  if (status === "streaming" && eventCount > ref.baselineEvents) reportFirstToken(ref, report);
  if (status === "streaming") return undefined;
  return settleTurn(ref, report);
}

function applyTiming(
  status: ChatStatus,
  eventCount: number,
  ref: Tracker,
  report: ChatTimingReporter,
  setLast: (ms: number) => void,
): void {
  const ms = stepTiming(status, eventCount, ref, report);
  if (ms !== undefined) setLast(ms);
}

/** Count visible assistant parts; protocol-only SSE frames never enter this set. */
export function businessEventCount(messages: readonly TimingMessage[]): number {
  return messages.reduce((count, message) => count + visiblePartCount(message), 0);
}

function visiblePartCount(message: TimingMessage): number {
  if (message.role !== "assistant") return 0;
  return message.parts.filter(isVisiblePart).length;
}

function isVisiblePart(part: TimingPart): boolean {
  if (part.type === "text") return part.text.trim() !== "";
  return part.type === "data-response";
}

/** Times first visible business output plus total turn duration. */
export function useTurnTiming(status: ChatStatus, eventCount: number, report: ChatTimingReporter = recordChatTiming) {
  const [lastDurationMs, setLastDurationMs] = useState<number>();
  const tracker = useRef<Tracker>({ startedAt: 0, firstToken: false, baselineEvents: 0 });
  const reportRef = useRef(report);
  useEffect(() => { reportRef.current = report; });
  useEffect(() => {
    applyTiming(status, eventCount, tracker.current, reportRef.current, setLastDurationMs);
  }, [eventCount, status]);
  return lastDurationMs;
}
