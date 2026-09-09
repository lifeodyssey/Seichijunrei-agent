import { canonicalHash, type MigrationChecksum, type PreflightMetadata } from "./preflight-metadata";

interface Revision extends MigrationChecksum {
  type: string;
  applied: string;
  total: string;
  error: string | null;
}

type Refusal = "ledger_empty" | "malformed_ledger" | "baseline_cutover_required" |
  "unsupported_revision_type" | "incomplete_revision" | "divergent_history" | "database_ahead";

export type MigrationCompatibility =
  | { compatible: true; expectedHead: string; appliedHead: string; pendingCount: number }
  | { compatible: false; error: Refusal };

function revision(value: unknown): value is Revision {
  if (typeof value !== "object" || value === null) return false;
  const fields: Record<string, unknown> = { ...value };
  const strings = ["version", "description", "hash", "type", "applied", "total"];
  return strings.every((key) => typeof fields[key] === "string") &&
    (fields.error === null || typeof fields.error === "string");
}

function completed(row: Revision): boolean {
  return /^(0|[1-9]\d*)$/.test(row.applied) && row.applied === row.total &&
    (row.error === null || row.error === "");
}

function rowRefusal(row: Revision, expected: MigrationChecksum | undefined): Refusal | undefined {
  if (row.type === "1") return "baseline_cutover_required";
  if (row.type !== "2") return "unsupported_revision_type";
  if (!completed(row)) return "incomplete_revision";
  if (expected === undefined || row.version !== expected.version) return "divergent_history";
  if (row.description !== expected.description || canonicalHash(row.hash) !== expected.hash) return "divergent_history";
  return undefined;
}

/** Compare the entire snapshot; the last completed head alone cannot prove ancestry. */
export function compareMigrationPrefix(metadata: PreflightMetadata, snapshot: unknown): MigrationCompatibility {
  if (!Array.isArray(snapshot) || !snapshot.every(revision)) return { compatible: false, error: "malformed_ledger" };
  if (snapshot.length === 0) return { compatible: false, error: "ledger_empty" };
  const selected = metadata.entries.at(-1);
  if (!selected) return { compatible: false, error: "malformed_ledger" };
  if (snapshot.some((row) => row.version > selected.version)) return { compatible: false, error: "database_ahead" };
  for (const [index, row] of snapshot.entries()) {
    const error = rowRefusal(row, metadata.entries[index]);
    if (error) return { compatible: false, error };
  }
  const last = snapshot.at(-1);
  if (!last) return { compatible: false, error: "ledger_empty" };
  return { compatible: true, expectedHead: metadata.expectedHead,
    appliedHead: `${last.version}_${last.description}`, pendingCount: metadata.entries.length - snapshot.length };
}
