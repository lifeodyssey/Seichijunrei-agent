/**
 * Row constructors for the agent-tier database tests (#1251). Named for what
 * they build, and every one of them writes through the same committed schema
 * the production statements do.
 */
import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { isJsonRecord } from "../src/agent/json-record.ts";
import type { QuotaReservation } from "../src/agent/intake/quota-reservation.ts";
import type { TurnSubmission } from "../src/agent/intake/turn-intake.ts";
import type { RunFailureReason, RunPayer, UsageScope } from "../src/db/schema.ts";

/**
 * The driver handle this arm's row constructors write through —
 * `AgentDataPlane.database` (`postgres-arm.ts`), node-postgres because that is
 * what reaches a container.
 *
 * NOT `src/db/agent-database.ts`'s `AgentDatabase`, which it was called until
 * #1436: that one is the production port, a unit of work on the data plane,
 * and the two names met when it was introduced. This one exists only in this
 * lane and only because a seeding statement needs a connection to run on.
 */
export type AgentArmDatabase = NodePgDatabase;

/** Far enough out that `runs_lease_within_deadline_check` never gets in a
 * seeded row's way; the sweep reads leases, not deadlines. */
const FAR_DEADLINE = "2099-01-01T00:00:00.000Z";

/** The one row a single-row query returned. */
export function onlyRow(result: { rows: unknown[] }): Record<string, unknown> {
  const [row] = result.rows;
  if (!isJsonRecord(row)) throw new Error("expected exactly one row");
  return row;
}

/** One anonymous submission; overrides name what the case is about. */
export function makeSubmission(overrides: Partial<TurnSubmission> = {}): TurnSubmission {
  return {
    sessionId: "session-1",
    identityId: "anon_0123456789abcdef0123456789abcdef",
    payer: "anon",
    clientMessageId: "cmid-1",
    text: "秩父の聖地を回りたい",
    selection: null,
    ...overrides,
  };
}

/** The session row every message and run hangs off (FK, ON DELETE CASCADE).
 * `ownerId` is the identity `ConversationRetrieval` checks a reader against;
 * a session left unowned is the anonymous transcript the retrieval refuses. */
export async function seedSession(
  database: AgentArmDatabase,
  sessionId: string,
  ownerId: string | null = null,
): Promise<void> {
  await database.execute(
    sql`insert into sessions (id, user_id) values (${sessionId}, ${ownerId})
        on conflict (id) do nothing`,
  );
}

/** One transcript row, stamped at the instant the case is about. */
export interface SeededMessage {
  readonly sessionId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  /** ISO instant; the retrieval orders on it. */
  readonly createdAt: string;
  /** The `response_data` envelope, or none. */
  readonly responseData?: Record<string, unknown> | null;
  /** The row's own key, for a case about two rows stamped in the SAME instant:
   * `uuidv7()` would hand out ids in insertion order and hide the tie. */
  readonly id?: string;
}

/** The envelope column as the row carries it: SQL NULL when there is none,
 * which is what the intake writes for a user message. */
function envelopeOf(message: SeededMessage): string | null {
  const envelope = message.responseData ?? null;
  return envelope === null ? null : JSON.stringify(envelope);
}

export async function seedMessage(database: AgentArmDatabase, message: SeededMessage): Promise<void> {
  await database.execute(
    sql`insert into messages (id, session_id, role, content, response_data, created_at)
        values (coalesce(${message.id ?? null}::uuid, uuidv7()), ${message.sessionId},
                ${message.role}, ${message.content},
                ${envelopeOf(message)}::jsonb, ${message.createdAt})`,
  );
}

export interface SeededRun {
  readonly sessionId: string;
  readonly status: "running" | "succeeded" | "failed";
  /** Why the turn failed — required exactly when it did (`runs_failed_has_reason_check`). */
  readonly failureReason?: RunFailureReason | null;
  /** ISO instant, or null for a run that never took a lease. */
  readonly leaseExpiresAt: string | null;
  /** Who pays for the turn; the anonymous visitor unless a case says otherwise. */
  readonly payer?: RunPayer;
  /** The counter row this run reserved a message in, or none for an unmetered turn. */
  readonly reservation?: QuotaReservation | null;
  /** A refund this run already took — the marker a second refund must lose to. */
  readonly quotaRefundedAt?: string | null;
  /** A rollup this run already had — the marker a second settlement must lose to. */
  readonly usageSettledAt?: string | null;
}

/** A session, its user message and one run in the state the case needs. */
export async function seedRun(database: AgentArmDatabase, run: SeededRun): Promise<string> {
  await seedSession(database, run.sessionId);
  const message = await database.execute(
    sql`insert into messages (session_id, role, content)
        values (${run.sessionId}, 'user', 'seeded') returning id`,
  );
  const messageId = String(onlyRow(message).id);
  return String(onlyRow(await database.execute(insertSeededRun(run, messageId))).id);
}

function insertSeededRun(run: SeededRun, messageId: string) {
  return sql`insert into runs
      (session_id, message_id, status, failure_reason, lease_owner, lease_expires_at, deadline_at,
       finished_at, payer, quota_identity_id, quota_usage_date, quota_refunded_at, usage_settled_at)
    values (${run.sessionId}, ${messageId}, ${run.status}, ${run.failureReason ?? null},
            ${leaseOwnerOf(run)}, ${run.leaseExpiresAt}, ${FAR_DEADLINE}, ${finishedAtOf(run)},
            ${run.payer ?? "anon"}, ${seededQuota(run)})
    returning id`;
}

/** A lease is an (owner, expiry) pair or neither — `runs_lease_held_check`. */
function leaseOwnerOf(run: SeededRun): string | null {
  return run.leaseExpiresAt === null ? null : "do-incarnation-1";
}

/** A terminal run has a finish; a running one has none — `runs_terminal_is_finished_check`. */
function finishedAtOf(run: SeededRun): string | null {
  return run.status === "running" ? null : FAR_DEADLINE;
}

/** The quota and settlement markers a case seeds, as one values fragment. */
function seededQuota(run: SeededRun): SQL {
  const reserved = run.reservation ?? null;
  return sql`${reserved?.identityId ?? null}, ${reserved?.usageDate ?? null},
    ${run.quotaRefundedAt ?? null}, ${run.usageSettledAt ?? null}`;
}

/** One settled tool step of one run. `input` is what the tool EXECUTED with —
 * pi's product, not the arguments the model asked with — and `result` rides
 * with `finished_at` because `run_steps_settled_check` admits nothing else. */
export interface SeededStep {
  readonly runId: string;
  readonly stepIndex: number;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
}

export async function seedStep(database: AgentArmDatabase, step: SeededStep): Promise<void> {
  await database.execute(
    sql`insert into run_steps (run_id, step_index, tool_name, input, result, finished_at)
        values (${step.runId}, ${step.stepIndex}, ${step.toolName},
                ${JSON.stringify(step.input)}::jsonb, '{"content": []}'::jsonb, ${FAR_DEADLINE})`,
  );
}

/** How many rows one table holds right now. */
export async function countRows(database: AgentArmDatabase, table: string): Promise<number> {
  const counted = await database.execute(sql`select count(*)::int as total from ${sql.identifier(table)}`);
  return Number(onlyRow(counted).total);
}

/** Today's reserved message count for one anonymous identity. */
export async function reservedCount(database: AgentArmDatabase, anonId: string): Promise<number> {
  const counted = await database.execute(
    sql`select coalesce(sum(message_count), 0)::int as total
        from anon_daily_message_count where anon_id = ${anonId}`,
  );
  return Number(onlyRow(counted).total);
}

/** The messages one identity has already reserved on one day. */
export async function seedReservedMessages(
  database: AgentArmDatabase,
  reservation: QuotaReservation,
  messageCount: number,
): Promise<void> {
  await database.execute(
    sql`insert into anon_daily_message_count (usage_date, anon_id, message_count)
        values (${reservation.usageDate}, ${reservation.identityId}, ${messageCount})`,
  );
}

/** The messages still charged to the exact counter row a run reserved in. */
export async function reservedOn(
  database: AgentArmDatabase,
  reservation: QuotaReservation,
): Promise<number> {
  const counted = await database.execute(
    sql`select coalesce(sum(message_count), 0)::int as total from anon_daily_message_count
        where usage_date = ${reservation.usageDate} and anon_id = ${reservation.identityId}`,
  );
  return Number(onlyRow(counted).total);
}

/**
 * What one day-scope row of the usage meter holds. Aggregated rather than
 * selected so a day nothing has been banked into reads as zeros instead of
 * throwing — "this settlement added nothing" is an assertion, not an absence.
 */
export async function bankedUsage(
  database: AgentArmDatabase,
  scope: UsageScope,
  day: string,
): Promise<Record<string, unknown>> {
  const banked = await database.execute(
    sql`select coalesce(sum(requests), 0)::int as requests,
               coalesce(sum(input_tokens), 0)::int as input_tokens,
               coalesce(sum(output_tokens), 0)::int as output_tokens,
               coalesce(sum(cost_usd), 0)::numeric(14,6)::text as cost_usd
        from daily_usage where usage_date = ${day} and scope = ${scope}`,
  );
  return onlyRow(banked);
}

/**
 * Everything a settlement writes on one run. The instants come back as epoch
 * milliseconds in text: drizzle hands a timestamptz to its caller as the
 * driver's own format (`workers/users/AGENTS.md`), and text keeps a column that
 * was never written comparable as `null`.
 */
export async function runSettlement(
  database: AgentArmDatabase,
  runId: string,
): Promise<Record<string, unknown>> {
  return onlyRow(await database.execute(selectSettlement(runId)));
}

function selectSettlement(runId: string) {
  return sql`select status, failure_reason, input_tokens::int as input_tokens,
      output_tokens::int as output_tokens, cost_usd::text as cost_usd,
      (extract(epoch from finished_at) * 1000)::bigint::text as finished_ms,
      (extract(epoch from usage_settled_at) * 1000)::bigint::text as settled_ms,
      (extract(epoch from quota_refunded_at) * 1000)::bigint::text as refunded_ms
    from runs where id = ${runId}`;
}
