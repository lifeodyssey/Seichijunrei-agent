import { HASH_A, HASH_B, revision } from "./preflight-fixtures";

export const secondRevision = revision({ version: "20260102000000", description: "extend", hash: HASH_B });

export const PREFIX_CASES = [
  { name: "Atlas bare-base64 prefix", rows: [revision()], status: 200, pendingCount: 1 },
  { name: "HTTP h1 prefix", rows: [revision({ hash: `h1:${HASH_A}` })], status: 200, pendingCount: 1 },
  { name: "exact-head no-op", rows: [revision(), secondRevision], status: 200, pendingCount: 0 },
  { name: "zero-statement completed file", rows: [revision({ applied: "0", total: "0" })], status: 200, pendingCount: 1 },
];

export const REFUSAL_CASES = [
  { name: "empty", rows: [], error: "ledger_empty" },
  { name: "partial", rows: [revision({ applied: "0" })], error: "incomplete_revision" },
  { name: "over-applied", rows: [revision({ applied: "2" })], error: "incomplete_revision" },
  { name: "negative counters", rows: [revision({ applied: "-1", total: "-1" })], error: "incomplete_revision" },
  { name: "error", rows: [revision({ error: "secret SQL detail" })], error: "incomplete_revision" },
  { name: "earlier hash divergence", rows: [revision({ hash: HASH_B }), secondRevision], error: "divergent_history" },
  { name: "malformed hash", rows: [revision({ hash: "h1:invalid" })], error: "divergent_history" },
  { name: "description divergence", rows: [revision({ description: "other" })], error: "divergent_history" },
  { name: "missing first row", rows: [secondRevision], error: "divergent_history" },
  { name: "duplicate", rows: [revision(), revision()], error: "divergent_history" },
  { name: "newer database", rows: [revision(), secondRevision, revision({ version: "20260103000000" })], error: "database_ahead" },
  { name: "native baseline", rows: [revision({ type: "1" })], error: "baseline_cutover_required" },
  { name: "resolved", rows: [revision({ type: "4" })], error: "unsupported_revision_type" },
  { name: "execute resolved", rows: [revision({ type: "6" })], error: "unsupported_revision_type" },
  { name: "unknown type", rows: [revision({ type: "0" })], error: "unsupported_revision_type" },
];
