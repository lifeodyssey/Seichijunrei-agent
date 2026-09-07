import { headOf, type ChainFile } from "./chain";
import type { ContainerOutcome } from "./migration";

/**
 * #1365 — the segment of the bundled chain one request may apply.
 *
 * `expectedHead` is the head the caller asked for, and the apply stops there:
 * a request for A against an A→B bundle applies A and leaves B pending.
 * Unbounded, `applyPending` walked every pending file, so an A request advanced
 * the database to B and only then failed the head check — after the schema had
 * already moved (CodeRabbit on #1471). A ledger standing past the requested
 * head cannot be satisfied by applying anything, so it is refused rather than
 * silently reporting a head the caller did not ask for.
 */
export type RequestedChain = { kind: "files"; files: ChainFile[] } | Refusal;

type Refusal = Extract<ContainerOutcome, { kind: "refused" }>;

/** The files to apply for `expectedHead`, or the refusal that stops it before any DDL. */
export function requestedChain(
  files: ChainFile[],
  applied: ReadonlySet<string>,
  expectedHead: string | undefined,
): RequestedChain {
  if (expectedHead === undefined) return { kind: "files", files };
  const requested = throughHead(files, expectedHead);
  if (requested === undefined) return refused(`bundled chain cannot reach expected head ${expectedHead}`);
  const ahead = headBeyond(requested, applied);
  if (ahead === undefined) return { kind: "files", files: requested };
  return refused(`applied version ${ahead} is not reached by expected head ${expectedHead}`);
}

/** The ledger's own head when this request does not reach it: the database is ahead. */
function headBeyond(requested: ChainFile[], applied: ReadonlySet<string>): string | undefined {
  const head = appliedHeadOf(applied);
  if (head === undefined) return undefined;
  return requested.some((file) => file.version === head) ? undefined : head;
}

/** The chain truncated after the file that leaves `head` in the ledger. */
function throughHead(files: ChainFile[], head: string): ChainFile[] | undefined {
  const end = files.findIndex((file) => headOf(file) === head);
  return end < 0 ? undefined : files.slice(0, end + 1);
}

/** The furthest version the ledger has finished — Atlas orders revisions by version. */
function appliedHeadOf(applied: ReadonlySet<string>): string | undefined {
  return [...applied].sort().at(-1);
}

function refused(reason: string): Refusal {
  return { kind: "refused", reason };
}
