import type { Entry, UsageRow } from "@earendil-works/pi-agent-core/harness/session";

/** Use recorded native costs. Zero may be free or unpriced; the ledger supplies no distinction. */
export function chargeUsage(row: UsageRow, entry: Entry | undefined, payer: string) {
  if (payer !== "anon" && payer !== "user" && payer !== "byok") throw new Error("Unknown admitted payer");
  if (row.entryId && !entry) throw new Error("A native usage entry is missing");
  const scope = usageScope(entry, payer);
  const usage = row.usage;
  return { scope, requests: row.adjustment ? 0 : 1, inputTokens: usage.input,
    outputTokens: usage.output, costUsd: String(scope === "byok" ? 0 : usage.cost.total) };
}

function usageScope(entry: Entry | undefined, payer: "anon" | "user" | "byok") {
  if (payer !== "byok" || entry?.type !== "message" || entry.message.role !== "toolResult") return payer;
  if (entry.message.toolName !== "translate_anime_title") return payer;
  return translationPayer(entry.message.details);
}

function translationPayer(details: unknown) {
  if (typeof details !== "object" || details === null || !("payer" in details)) throw new Error("Translation usage has no recorded payer");
  if (details.payer !== "platform" && details.payer !== "byok") throw new Error("Unknown translation payer");
  return details.payer;
}
