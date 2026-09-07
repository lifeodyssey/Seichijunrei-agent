import { filesFrom, type ChainFile, type ChainSource } from "./chain";
import type { ApplyLock } from "./lock";
import type { ContainerOutcome } from "./migration";
import { requestedChain } from "./requested-chain";
import { assertDirectDsn, type SqlClient, type SqlFactory, type SqlParam, type SqlStatement } from "./sql";
import { mixedTxMode, needsTxNone, splitSql } from "./sql-split";

/**
 * Atlas v0.30 `public.atlas_schema_revisions` shape this path writes:
 * - version = filename timestamp before first `_`; description = remainder
 * - type = 2 (`RevisionTypeExecute`); applied=total=1 on success; applied=0 on failure
 * - executed_at = timestamptz; execution_time = int64 nanoseconds (HTTP path stores 0)
 * - hash = exact `h1:…` token from atlas.sum; operator_version below
 * - on SQL failure: error + error_stmt, then stop (do not set applied=total)
 * - the success row rides in the file's own transaction (#1338), so there is no
 *   moment where the DDL is committed and the ledger still silent. It therefore
 *   stamps executed_at when the file's apply starts, not when it ends: the row
 *   travels with the statements and cannot be dated after them.
 */
export const OPERATOR_VERSION = "animichi-http-apply/0.30.0";
const MIXED_TX = "migration mixes transactional statements with CREATE INDEX CONCURRENTLY";
/** SQLSTATE `duplicate_table` — Postgres answers it for any relation that exists. */
const DUPLICATE_OBJECT = "42P07";

/**
 * Atlas creates the ledger on its own first apply; this path reads it before
 * writing, so a schema with no ledger yet made the first SELECT throw
 * `relation "public.atlas_schema_revisions" does not exist` and the whole apply
 * returned HTTP 500 with nothing applied. That was unreachable while staging was
 * only ever migrated incrementally, and became the normal first state once the
 * staging baseline reset started dropping and recreating `public` (#1216).
 * Columns are Atlas v0.30's own, dumped from a database it migrated.
 */
const LEDGER_SQL = `CREATE TABLE IF NOT EXISTS public.atlas_schema_revisions (
  version varchar NOT NULL,
  description varchar NOT NULL,
  type bigint NOT NULL DEFAULT 2,
  applied bigint NOT NULL DEFAULT 0,
  total bigint NOT NULL DEFAULT 0,
  executed_at timestamptz NOT NULL,
  execution_time bigint NOT NULL,
  error text,
  error_stmt text,
  hash varchar NOT NULL,
  partial_hashes jsonb,
  operator_version varchar NOT NULL,
  PRIMARY KEY (version)
)`;
const APPLIED_SQL = "SELECT version FROM public.atlas_schema_revisions WHERE applied >= total";
const UNFINISHED_SQL = "SELECT version, hash FROM public.atlas_schema_revisions WHERE applied < total";
/** Exported so tests can assert which request the revision row travels in. */
export const REVISION_UPSERT_SQL = `INSERT INTO public.atlas_schema_revisions (version, description, type, applied, total, executed_at, execution_time, error, error_stmt, hash, operator_version) VALUES ($1, $2, 2, $3, 1, $4, $5, $6, $7, $8, $9) ON CONFLICT (version) DO UPDATE SET applied = EXCLUDED.applied, total = EXCLUDED.total, execution_time = EXCLUDED.execution_time, error = EXCLUDED.error, error_stmt = EXCLUDED.error_stmt, hash = EXCLUDED.hash, operator_version = EXCLUDED.operator_version`;

export interface ApplyInput {
  dsn: string;
  source: ChainSource;
  connect: SqlFactory;
  now: () => Date;
  /**
   * The head the caller asked for. The apply STOPS there: an A request against
   * an A→B bundle applies A and leaves B pending. Omitted means "the whole
   * carried chain", which is what an `expectedHead`-less POST asks for.
   */
  expectedHead?: string;
}

export interface HttpApplyInput extends ApplyInput {
  lock: ApplyLock;
}

/** What the ledger already knows: finished versions, plus the hash each unfinished attempt recorded. */
interface LedgerState {
  readonly applied: Set<string>;
  readonly attemptedHash: ReadonlyMap<string, string>;
}

/**
 * How one file is to be committed: the row to record, and whether a duplicate
 * object may be read as this chain's own interrupted attempt (see `runSerial`).
 */
interface FileCommit {
  readonly row: RevisionWrite;
  readonly resumable: boolean;
}

interface RevisionWrite {
  version: string;
  description: string;
  applied: number;
  executedAt: Date;
  error: string | null;
  errorStmt: string | null;
  hash: string;
}

/** Serialize then apply the bundled chain. Tests inject a fake lock. */
export function applyHttp(input: HttpApplyInput): Promise<ContainerOutcome> {
  return input.lock.runExclusive(() => applyChain(input));
}

/** Apply committed files over neon-http. Rejects `-pooler` before connect/SQL. */
export async function applyChain(input: ApplyInput): Promise<ContainerOutcome> {
  assertDirectDsn(input.dsn);
  return applyFiles(input);
}

async function applyFiles(input: ApplyInput): Promise<ContainerOutcome> {
  const sql = input.connect(input.dsn);
  await sql.query(LEDGER_SQL);
  const ledger = await loadLedger(sql);
  const requested = requestedChain(filesFrom(input.source), ledger.applied, input.expectedHead);
  if (requested.kind === "refused") return requested;
  return applyPending(sql, requested.files, ledger, input.now);
}

async function applyPending(
  sql: SqlClient,
  files: ChainFile[],
  ledger: LedgerState,
  now: () => Date,
): Promise<ContainerOutcome> {
  for (const file of files) {
    const failed = await applyOne(sql, file, ledger, now);
    if (failed !== undefined) return failed;
  }
  return { kind: "success", exitCode: 0 };
}

async function applyOne(
  sql: SqlClient,
  file: ChainFile,
  ledger: LedgerState,
  now: () => Date,
): Promise<ContainerOutcome | undefined> {
  if (ledger.applied.has(file.version)) return undefined;
  const error = await commitFile(sql, file, ledger, now());
  if (error !== undefined) return recordFailure(sql, file, error, now());
  ledger.applied.add(file.version);
  return undefined;
}

/** One file is one commit: its statements and its revision row land together. */
async function commitFile(sql: SqlClient, file: ChainFile, ledger: LedgerState, at: Date): Promise<Error | undefined> {
  const commit = { row: okRow(file, at), resumable: resumesOwnAttempt(file, ledger) };
  return execCaught(() => applyStatements(sql, splitSql(file.body), commit));
}

/**
 * True when the ledger holds no attempt at this version under a different hash:
 * either nothing was recorded (the crash this guard exists for leaves no row) or
 * the recorded attempt is the same file `atlas.sum` vouches for now. A version
 * last attempted under a different hash has been edited since, so an object that
 * already exists there means the migration is wrong, not that a run was cut off.
 */
function resumesOwnAttempt(file: ChainFile, ledger: LedgerState): boolean {
  const attempted = ledger.attemptedHash.get(file.version);
  return attempted === undefined || attempted === file.hash;
}

async function execCaught(run: () => Promise<unknown>): Promise<Error | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function applyStatements(sql: SqlClient, statements: readonly string[], commit: FileCommit): Promise<unknown> {
  if (mixedTxMode(statements)) return Promise.reject(new Error(MIXED_TX));
  if (statements.some(needsTxNone)) return runSerial(sql, statements, commit);
  return sql.transaction([...statements.map(ddlStatement), revisionUpsert(commit.row)]);
}

/**
 * `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, so this path
 * commits each statement on its own and writes the revision row after them: the
 * window the transactional path closes is inherent here. A run that dies in it
 * leaves the objects created and the ledger silent, and the next run meets its
 * own objects. That is why a duplicate-object error is read on THIS path, and
 * only for a resumable file, as "already applied" — it is what lets the chain
 * finish the file and record it instead of failing identically forever. On the
 * transactional path a duplicate stays fatal: no such window exists there.
 */
async function runSerial(sql: SqlClient, statements: readonly string[], commit: FileCommit): Promise<void> {
  for (const stmt of statements) await execAllowingDuplicate(sql, stmt, commit.resumable);
  await writeRevision(sql, commit.row);
}

async function execAllowingDuplicate(sql: SqlClient, stmt: string, resumable: boolean): Promise<void> {
  const error = await execCaught(() => sql.query(stmt));
  if (error === undefined || (resumable && isDuplicateObject(error))) return;
  throw error;
}

/** neon-http puts the Postgres SQLSTATE on the thrown error (`NeonDbError.code`). */
function isDuplicateObject(error: Error): boolean {
  if (!("code" in error)) return false;
  return typeof error.code === "string" && error.code === DUPLICATE_OBJECT;
}

async function recordFailure(sql: SqlClient, file: ChainFile, error: Error, at: Date): Promise<ContainerOutcome> {
  await writeRevision(sql, failRow(file, error, at));
  return { kind: "failure", exitCode: 1, error: error.message };
}

async function loadLedger(sql: SqlClient): Promise<LedgerState> {
  const applied = new Set(versionsIn(await sql.query(APPLIED_SQL)));
  return { applied, attemptedHash: new Map(attemptsIn(await sql.query(UNFINISHED_SQL))) };
}

function versionsIn(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap(versionCell);
}

function versionCell(row: unknown): string[] {
  if (!isRow(row) || !("version" in row)) return [];
  return typeof row.version === "string" ? [row.version] : [];
}

function attemptsIn(rows: unknown): [string, string][] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap(attemptCell);
}

function attemptCell(row: unknown): [string, string][] {
  if (!isRow(row) || !("version" in row) || !("hash" in row)) return [];
  if (typeof row.version !== "string" || typeof row.hash !== "string") return [];
  return [[row.version, row.hash]];
}

function isRow(row: unknown): row is object {
  return typeof row === "object" && row !== null;
}

async function writeRevision(sql: SqlClient, row: RevisionWrite): Promise<void> {
  const upsert = revisionUpsert(row);
  await sql.query(upsert.text, upsert.params);
}

function ddlStatement(text: string): SqlStatement {
  return { text, params: [] };
}

function revisionUpsert(row: RevisionWrite): SqlStatement {
  return { text: REVISION_UPSERT_SQL, params: revisionParams(row) };
}

function revisionParams(row: RevisionWrite): SqlParam[] {
  return [row.version, row.description, row.applied, row.executedAt.toISOString(), 0, row.error, row.errorStmt, row.hash, OPERATOR_VERSION];
}

function okRow(file: ChainFile, at: Date): RevisionWrite {
  return { ...file, applied: 1, executedAt: at, error: null, errorStmt: null };
}

function failRow(file: ChainFile, error: Error, at: Date): RevisionWrite {
  return { ...okRow(file, at), applied: 0, error: error.message, errorStmt: file.body };
}
