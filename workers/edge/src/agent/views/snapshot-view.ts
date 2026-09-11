import type { LaneSnapshot } from "@earendil-works/pi-agent-core";

export function operationView(snapshot: LaneSnapshot, operationId: string) {
  const operation = snapshot.operation?.id === operationId ? snapshot.operation : undefined;
  const result = snapshot.lastResult?.operationId === operationId ? snapshot.lastResult : undefined;
  const scope = operation ?? result;
  if (!scope) return { operation, result, entries: [] };
  const from = scope.fromTipId;
  const first = afterEntry(snapshot, from) ?? 0;
  const last = afterEntry(snapshot, result?.tipId);
  return { operation, result, entries: snapshot.transcript.slice(first, last) };
}

function afterEntry(snapshot: LaneSnapshot, id: string | null | undefined) {
  return id ? snapshot.transcript.findIndex((entry) => entry.id === id) + 1 : undefined;
}
