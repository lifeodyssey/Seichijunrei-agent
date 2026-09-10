import type { Entry } from "@earendil-works/pi-agent-core/harness/session";
import type { z } from "zod";
import { ExecutedFacts } from "./tool-context-annotations.ts";

interface ToolFacts {
  pacing?: z.infer<typeof ExecutedFacts>["pacing"];
  retainedEntities: { toolName: string; value: string }[];
}

/** A bounded projection of committed outcomes; no mutable ledger or second persistence path. */
export function committedToolFacts(entries: readonly Entry[]): ToolFacts {
  return [...entries].sort((left, right) => left.seq - right.seq)
    .reduce<ToolFacts>((facts, entry) => afterEntry(facts, entry), { retainedEntities: [] });
}

function afterEntry(facts: ToolFacts, entry: Entry): ToolFacts {
  if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.isError) return facts;
  const details: unknown = entry.message.details;
  if (!details || typeof details !== "object" || !Object.hasOwn(details, "executedFacts")) return facts;
  const recorded = ExecutedFacts.parse(Reflect.get(details, "executedFacts"));
  return { pacing: recorded.pacing ?? facts.pacing,
    retainedEntities: recorded.retainedEntity ? retain(facts.retainedEntities, entry.message.toolName, recorded.retainedEntity) : facts.retainedEntities };
}

function retain(entities: ToolFacts["retainedEntities"], toolName: string, value: string) {
  const other = entities.filter((entry) => entry.toolName !== toolName || entry.value !== value);
  if (other.length === entities.length && other.length >= 8) return entities;
  return [...other, { toolName, value }];
}
