import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { UIMessageChunk } from "ai";
import type { SecretScrub } from "../egress/secret-scrub.ts";

/** Connection-local rendering offsets, never execution state or a replay buffer. */
export function messageProjection(scrub: SecretScrub) {
  const lengths = new Map<string, number>();
  const ended = new Set<string>();
  let current = "initial";
  let sequence = 0;
  const begin = (entryId?: string) => { current = entryId ?? `live-${String(sequence++)}`; };
  const update = (message: AgentMessage, complete: boolean): UIMessageChunk[] => {
    if (message.role !== "assistant") return [];
    return message.content.flatMap((part, index) => {
      if (part.type !== "text" && part.type !== "thinking") return [];
      const kind = part.type === "text" ? "text" : "reasoning";
      const id = `${current}-${String(index)}`;
      if (ended.has(id)) return [];
      const text = scrub.text(partText(part));
      const stable = stableText(text, complete, scrub.redactionTailLength);
      const prior = lengths.get(id);
      const chunks: UIMessageChunk[] = prior === undefined ? [{ type: `${kind}-start`, id }] : [];
      const offset = prior ?? 0;
      if (stable.length > offset) chunks.push({ type: `${kind}-delta`, id, delta: stable.slice(offset) });
      lengths.set(id, stable.length);
      if (complete) { chunks.push({ type: `${kind}-end`, id }); ended.add(id); }
      return chunks;
    });
  };
  return { begin, update };
}

function stableText(text: string, complete: boolean, tail: number) {
  return complete ? text : text.slice(0, Math.max(0, text.length - tail));
}
function partText(part: import("@earendil-works/pi-ai").TextContent | import("@earendil-works/pi-ai").ThinkingContent) {
  return part.type === "text" ? part.text : part.thinking;
}
