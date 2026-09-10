import { param } from "@prisma/orm-postgres/relational-core/expression";
import type { Entry, EntryScan, UsageRow, UsageScan } from "@earendil-works/pi-agent-core/harness/session";
import type { SessionDatabase, SessionReader, SessionTransaction } from "./database.ts";

export async function readEntries(db: SessionReader, sessionId: string, ids: string[]): Promise<Map<string, Entry>> {
  if (ids.length === 0) return new Map();
  const rows = await db.orm.public.PiRecord.where({ sessionId, kind: "entry" }).where((row) => row.id.in(ids)).select("id", "payload").all();
  const found = new Map(rows.map(({ id, payload }) => [id, payload as unknown as Entry]));
  return new Map(ids.flatMap((id) => { const entry = found.get(id); return entry === undefined ? [] : [[id, entry] as const]; }));
}

export async function scanEntries(db: SessionDatabase, sessionId: string, query: EntryScan, runtime: Pick<SessionTransaction, "query"> = db.runtime()): Promise<Entry[]> {
  const { type = null, customType = null, fromSeq = null, toSeq = null } = query;
  const plan = db.raw.sql`SELECT payload FROM pi_records WHERE session_id = ${sessionId} AND kind = 'entry'
    AND (${param(type, { codecId: "pg/text@1" })}::text IS NULL OR payload->>'type' = ${param(type, { codecId: "pg/text@1" })})
    AND (${param(customType, { codecId: "pg/text@1" })}::text IS NULL OR payload->>'customType' = ${param(customType, { codecId: "pg/text@1" })})
    AND (${param(fromSeq, { codecId: "pg/int8number@1" })}::bigint IS NULL OR seq >= ${param(fromSeq, { codecId: "pg/int8number@1" })})
    AND (${param(toSeq, { codecId: "pg/int8number@1" })}::bigint IS NULL OR seq <= ${param(toSeq, { codecId: "pg/int8number@1" })})
    ORDER BY CASE WHEN ${query.order === "desc"} THEN -seq ELSE seq END
    LIMIT ${param(query.limit === undefined ? null : Math.max(0, query.limit), { codecId: "pg/int8number@1" })}`.returnsRow({ payload: "pg/jsonb@1" }).build();
  return (await runtime.query(plan)).map(({ payload }) => payload as unknown as Entry);
}

export async function scanUsage(db: SessionReader, sessionId: string, query: UsageScan): Promise<UsageRow[]> {
  let rows = db.orm.public.PiRecord.where({ sessionId, kind: "usage" }).select("payload");
  if (query.fromSeq !== undefined) rows = rows.where((row) => row.seq.gte(query.fromSeq ?? 0));
  if (query.toSeq !== undefined) rows = rows.where((row) => row.seq.lte(query.toSeq ?? 0));
  rows = rows.orderBy((row) => query.order === "desc" ? row.seq.desc() : row.seq.asc());
  if (query.limit !== undefined) rows = rows.limit(Math.max(0, query.limit));
  return (await rows.all()).map(({ payload }) => payload as unknown as UsageRow);
}
