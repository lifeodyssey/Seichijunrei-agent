import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Entry } from "@earendil-works/pi-agent-core/harness/session";
import { projectPilgrimage } from "./pilgrimage-projection.ts";
import { quotedStatusValue, statusValue } from "./status-value.ts";
import { committedToolFacts } from "./committed-tool-facts.ts";
import { selectedSceneFacts } from "./selected-scene-facts.ts";

/** Fresh request-local context derived solely from committed native branch entries. */
export function agentStatusMessage(entries: readonly Entry[]): AgentMessage {
  const { currentAnime, clarification } = projectPilgrimage(entries);
  const lines = [
    ...(currentAnime ? [`Current anime: ${quotedStatusValue(currentAnime.title)} (${statusValue(currentAnime.bangumiId)}). It is already resolved for this session; use that id rather than resolving the title again.`] : []),
    ...(clarification ? [`Open question: ${statusValue(clarification.reason)}; candidate_ids=[${clarification.candidates.map((item) => statusValue(item.id)).join(", ")}]. The user's message may be answering it.`] : []),
    ...factLines(entries, currentAnime?.title),
    ...selectedSceneFacts(entries).map((scene) => `Selected scene: ${quotedStatusValue(scene)}.`), ...toolCallLines(entries),
  ];
  return { role: "user", content: `<agent_status>\n${lines.length ? lines.join("\n") : "No committed domain facts yet."}\n</agent_status>`, timestamp: 0 };
}

function factLines(entries: readonly Entry[], currentTitle: string | undefined): string[] {
  const facts = committedToolFacts(entries);
  const pacing = facts.pacing ? [`User hard constraint: ${facts.pacing} pacing. Apply this pacing to every subsequent plan_route call unless the user explicitly changes it.`] : [];
  const retained = facts.retainedEntities.filter((entity) => entity.value !== currentTitle).map((entity) =>
    `Verbatim entity retained from an earlier ${statusValue(entity.toolName)} call: ${quotedStatusValue(entity.value)}. Still treat it as valid context for anaphora and follow-up.`);
  return [...pacing, ...retained];
}

function toolCallLines(entries: readonly Entry[]): string[] {
  const ordered = [...entries].sort((left, right) => left.seq - right.seq);
  const boundary = ordered.map((entry) => entry.type === "message" ? entry.message.role : entry.type).lastIndexOf("user");
  const counts = new Map<string, number>();
  for (const entry of ordered.slice(boundary + 1)) {
    if (entry.type === "message" && entry.message.role === "toolResult") counts.set(entry.message.toolName, (counts.get(entry.message.toolName) ?? 0) + 1);
  }
  return counts.size ? [`Tool calls this turn: ${[...counts].map(([name, count]) => `${statusValue(name)} ×${String(count)}`).join(", ")}.`] : [];
}
