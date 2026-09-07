/**
 * #1051 — the migrator's core orchestration flow.
 *
 * Pure over injected boundaries so it is unit-testable at the HTTP seam:
 * snapshot the ledger (empty / missing table is a legal pre-state; a read
 * failure is unobserved and cannot prove advancement), run the one-shot
 * batch container (DSN injected), then read the applied head again. No
 * destructive path exists here: no schema drop, no arbitrary SQL, no
 * down-migration (spec §"Migration executor", capability boundary). A
 * platform `stopped` with no exit code is judged against expected head
 * plus whether this run advanced the ledger.
 */

export type ContainerOutcome =
  | { kind: "success"; exitCode: 0 }
  | { kind: "failure"; exitCode: number; error?: string }
  | { kind: "unknown_exit" }
  | { kind: "timeout"; ranMs: number; lastStatus: string; exitCode?: number }
  /** Nothing was applied: this bundle and ledger cannot satisfy the request. */
  | { kind: "refused"; reason: string };

export type PathVerification = "verified" | "unverified";

export type MigrationRunResult =
  | { kind: "success"; exitCode: 0; appliedHead: string | null; pathVerification: PathVerification }
  | { kind: "failure"; exitCode: number; error?: string }
  | { kind: "head_mismatch"; appliedHead: string | null; expectedHead: string | null }
  | { kind: "timeout"; ranMs: number; lastStatus: string; exitCode?: number }
  | { kind: "refused"; reason: string };

export interface MigrationBoundaries {
  /** The apply is bounded by `expectedHead`; it may not advance past it. */
  runContainer: (dsn: string, expectedHead?: string) => Promise<ContainerOutcome>;
  readAppliedHead: (dsn: string) => Promise<string | null>;
}

function mismatch(appliedHead: string | null, expectedHead: string | undefined): MigrationRunResult {
  return { kind: "head_mismatch", appliedHead, expectedHead: expectedHead ?? null };
}

function failOf(outcome: Extract<ContainerOutcome, { kind: "failure" }>): MigrationRunResult {
  if (outcome.error === undefined) return { kind: "failure", exitCode: outcome.exitCode };
  return { kind: "failure", exitCode: outcome.exitCode, error: outcome.error };
}

function succeeded(appliedHead: string | null, pathVerification: PathVerification): MigrationRunResult {
  return { kind: "success", exitCode: 0, appliedHead, pathVerification };
}

/** Observed empty/missing ledger is `null`; a failed read is not that `null`. */
type PreRunSnapshot =
  | { kind: "observed"; head: string | null }
  | { kind: "unobserved" };

function isUndefinedTable(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "42P01") {
    return true;
  }
  return error instanceof Error
    && error.message.includes("atlas_schema_revisions")
    && error.message.includes("does not exist");
}

function unknownExitProof(pre: PreRunSnapshot, postHead: string | null): PathVerification {
  if (pre.kind === "unobserved") return "unverified";
  return pre.head === postHead ? "unverified" : "verified";
}

/** Pre-run snapshot. Missing/empty is observed null; a read failure is unobserved. */
async function snapshotPreRunHead(
  dsn: string,
  boundaries: MigrationBoundaries,
): Promise<PreRunSnapshot> {
  try {
    return { kind: "observed", head: await boundaries.readAppliedHead(dsn) };
  } catch (error) {
    return isUndefinedTable(error) ? { kind: "observed", head: null } : { kind: "unobserved" };
  }
}

async function judgeUnknownExit(
  dsn: string,
  boundaries: MigrationBoundaries,
  expectedHead: string | undefined,
  pre: PreRunSnapshot,
): Promise<MigrationRunResult> {
  const postHead = await boundaries.readAppliedHead(dsn);
  if (expectedHead === undefined || postHead !== expectedHead) return mismatch(postHead, expectedHead);
  return succeeded(postHead, unknownExitProof(pre, postHead));
}

/** Run the chain and report the outcome + applied head. */
export async function runMigration(
  dsn: string,
  boundaries: MigrationBoundaries,
  expectedHead?: string,
): Promise<MigrationRunResult> {
  const pre = await snapshotPreRunHead(dsn, boundaries);
  const outcome = await boundaries.runContainer(dsn, expectedHead);
  if (outcome.kind === "failure") return failOf(outcome);
  if (outcome.kind === "refused") return { ...outcome };
  if (outcome.kind === "timeout") return { ...outcome };
  if (outcome.kind === "unknown_exit") return judgeUnknownExit(dsn, boundaries, expectedHead, pre);
  return succeeded(await boundaries.readAppliedHead(dsn), "verified");
}
