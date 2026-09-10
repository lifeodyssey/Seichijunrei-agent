import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import type { AgentLane, LaneSnapshot, WatchHandle } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { SecretScrub } from "../egress/secret-scrub.ts";
import { eventChunks, snapshotChunks } from "./event-chunks.ts";
import { SAFE_FAILURE } from "./public-content.ts";
import { messageProjection } from "./message-chunks.ts";
import { operationView } from "./snapshot-view.ts";

type WriteChunk = (chunk: UIMessageChunk) => void;

/** Validate against the native snapshot; a later terminal read must never truncate its queued live events. */
export async function watchNativeOperation(lane: AgentLane, operationId: string, context: Context) {
  const watch = await lane.watch(context);
  if (watch.snapshot.operation?.id === operationId || watch.snapshot.lastResult?.operationId === operationId) return watch;
  try {
    const result = await lane.getResult(operationId, context);
    if (!result) { watch.unsubscribe(); return undefined; }
    // A native context snapshot stops at compaction; restore the immutable visible branch for old answers.
    const transcript = watch.snapshot.tipId ? await lane.findEntries({ start: watch.snapshot.tipId, order: "oldestFirst" }, context) : [];
    if (result.tipId && !transcript.some((entry) => entry.id === result.tipId)) { watch.unsubscribe(); return undefined; }
    watch.snapshot = { ...watch.snapshot, transcript, lastResult: result };
    return watch;
  } catch (error) { watch.unsubscribe(); throw error; }
}

/** The only framing gap: comments keep silent streams alive; cancellation releases only this view. */
function observedBody(body: ReadableStream<Uint8Array>, release: () => void) {
  const reader = body.getReader();
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = () => { clearInterval(timer); release(); };
  return new ReadableStream<Uint8Array>({
    start(controller) { timer = setInterval(() => { controller.enqueue(new TextEncoder().encode(": heartbeat\n\n")); }, 15_000); },
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) { close(); controller.close(); return; }
        controller.enqueue(next.value);
      } catch (error) { close(); controller.error(error); }
    },
    async cancel() { close(); await reader.cancel(); },
  });
}

function restoreMessages(snapshot: LaneSnapshot, operationId: string, project: ReturnType<typeof messageProjection>, write: WriteChunk) {
  const view = operationView(snapshot, operationId);
  for (const entry of view.entries) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    project.begin(entry.id);
    project.update(entry.message, true).forEach(write);
  }
  if (!view.operation?.streamingMessage) return;
  project.begin();
  project.update(view.operation.streamingMessage, false).forEach(write);
}

function watchInto(watch: WatchHandle<LaneSnapshot>, sessionId: string, operationId: string, scrub: SecretScrub, write: WriteChunk, stop: () => void) {
  const project = messageProjection(scrub);
  write({ type: "start", messageId: operationId });
  write({ type: "start-step" });
  restoreMessages(watch.snapshot, operationId, project, write);
  const snapshot = snapshotChunks(watch.snapshot, sessionId, operationId, scrub);
  snapshot.forEach(write);
  if (snapshot.some((chunk) => chunk.type === "finish")) { stop(); return; }
  watch.start((event) => {
    if ("runId" in event && event.runId !== operationId) return;
    if (event.type === "message_start" && event.message.role === "assistant") project.begin();
    if (event.type === "message_update" || event.type === "message_end") project.update(event.message, event.type === "message_end").forEach(write);
    eventChunks(event, sessionId, scrub).forEach(write);
    if (event.type === "run_end" || event.type === "fault") stop();
  });
}

/** Native watch owns snapshot/live pairing. No application replay buffer or execution loop exists. */
export function nativeWatchResponse(watch: WatchHandle<LaneSnapshot>, sessionId: string, operationId: string, scrub: SecretScrub) {
  let stop = () => { watch.unsubscribe(); };
  const stream = createUIMessageStream({ onError: () => SAFE_FAILURE, execute: ({ writer }) => new Promise<void>((resolve) => {
    stop = () => { watch.unsubscribe(); resolve(); };
    watchInto(watch, sessionId, operationId, scrub, (chunk) => { writer.write(chunk); }, stop);
  }) });
  const response = createUIMessageStreamResponse({ stream, headers: { "x-session-id": sessionId, "x-operation-id": operationId,
    "access-control-expose-headers": "x-session-id, x-operation-id", "cache-control": "no-store" } });
  if (!response.body) throw new Error("The native UI message stream has no body");
  const body = response.body as ReadableStream<Uint8Array>;
  return new Response(observedBody(body, () => { stop(); }), { status: response.status, headers: response.headers });
}
