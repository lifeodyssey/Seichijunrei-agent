import { operationMeta, operationResult, type Entry, type SessionReader, type OperationResultRecord } from "@earendil-works/pi-agent-core/harness/session";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";

type OperationRange = Pick<OperationResultRecord, "operationId" | "fromTipId" | "tipId">;

/** The SDK atomically replaces metadata with a result. Read metadata first so a finishing run cannot disappear between reads. */
export async function historyOperations(storage: SessionReader, entries: readonly Entry[], context: Context) {
  if (!entries.length) return new Map<string, string>();
  const active = await storage.scanValues(operationMeta(""), context);
  const results = await storage.scanValues(operationResult(""), context);
  const operations = new Map<string, OperationRange>(active.filter(({ value }) => value.lane === "main" && value.intent.kind === "run")
    .map(({ value }) => [value.operationId, { operationId: value.operationId, fromTipId: value.sourceTipId, tipId: entries.at(-1)?.id ?? null }]));
  for (const { value } of results) if (value.kind === "run") operations.set(value.operationId, value);
  return identifyOperationEntries(storage, entries, [...operations.values()], context);
}

async function identifyOperationEntries(storage: SessionReader, entries: readonly Entry[], operations: readonly OperationRange[], context: Context) {
  const indices = new Map(entries.map((entry, index) => [entry.id, index]));
  const ids = new Map<string, string>();
  for (const operation of operations) {
    const from = operation.fromTipId === null ? -1 : indices.get(operation.fromTipId);
    if (from === undefined) continue;
    const to = await visibleOperationTip(storage, entries, indices, operation, context);
    if (to === undefined) continue;
    for (const entry of entries.slice(from + 1, to + 1)) ids.set(entry.id, operation.operationId);
  }
  return ids;
}

/** A result may finish beyond the captured page. Clamp only along its real ancestry, never across a sibling branch. */
async function visibleOperationTip(storage: SessionReader, entries: readonly Entry[], indices: ReadonlyMap<string, number>, operation: OperationRange, context: Context) {
  if (!operation.tipId) return undefined;
  const to = indices.get(operation.tipId);
  const captured = entries.at(-1);
  if (to !== undefined || !captured) return to;
  const ancestry = await storage.scanBranch({ start: operation.tipId, stopAtId: captured.id, order: "newestFirst" }, context);
  return ancestry.some((entry) => entry.id === captured.id) ? entries.length - 1 : undefined;
}
