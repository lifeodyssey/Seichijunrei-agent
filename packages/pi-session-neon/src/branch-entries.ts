import { param } from "@prisma/orm-postgres/relational-core/expression";
import type { Entry, EntryStructure, StorageBranchScan } from "@earendil-works/pi-agent-core/harness/session";
import type { SessionDatabase } from "./database.ts";
import { readEntries } from "./entries.ts";

async function readBranch(db: SessionDatabase, sessionId: string, query: StorageBranchScan, structure: boolean) {
  if (!(await readEntries(db, sessionId, [query.start])).has(query.start)) throw new Error(`Unknown branch start: ${query.start}`);
  const oldest = query.order === "oldestFirst";
  const { type = null, customType = null, stopAtId = null, stopAtType = null } = query;
  const cursor = query.cursor?.seq ?? null;
  const plan = db.raw.sql`WITH RECURSIVE ancestors AS (
    SELECT id, seq, payload FROM pi_records WHERE session_id = ${sessionId} AND kind = 'entry' AND id = ${query.start}
    UNION ALL SELECT e.id, e.seq, e.payload FROM pi_records e JOIN ancestors a ON e.id = a.payload->>'parentId'
      WHERE e.session_id = ${sessionId} AND e.kind = 'entry'
  ), stopped AS (
    SELECT *, (SELECT CASE WHEN ${oldest} THEN min(seq) ELSE max(seq) END FROM ancestors
      WHERE id = ${param(stopAtId, { codecId: "pg/text@1" })} OR payload->>'type' = ${param(stopAtType, { codecId: "pg/text@1" })}) AS stop_seq FROM ancestors
  ) SELECT CASE WHEN ${structure} THEN jsonb_build_object('id', id, 'parentId', payload->'parentId', 'seq', seq,
      'timestamp', payload->'timestamp', 'type', payload->'type')
      || CASE WHEN payload ? 'customType' THEN jsonb_build_object('customType', payload->'customType') ELSE '{}'::jsonb END
      ELSE payload END AS entry FROM stopped
    WHERE (stop_seq IS NULL OR CASE WHEN ${oldest} THEN seq <= stop_seq ELSE seq >= stop_seq END)
      AND (${param(type, { codecId: "pg/text@1" })}::text IS NULL OR payload->>'type' = ${param(type, { codecId: "pg/text@1" })})
      AND (${param(customType, { codecId: "pg/text@1" })}::text IS NULL OR payload->>'customType' = ${param(customType, { codecId: "pg/text@1" })})
      AND (${param(cursor, { codecId: "pg/int8number@1" })}::bigint IS NULL OR CASE WHEN ${oldest} THEN seq > ${param(cursor, { codecId: "pg/int8number@1" })} ELSE seq < ${param(cursor, { codecId: "pg/int8number@1" })} END)
    ORDER BY CASE WHEN ${oldest} THEN seq ELSE -seq END
    LIMIT ${param(query.limit === undefined ? null : Math.max(0, query.limit), { codecId: "pg/int8number@1" })}`.returnsRow({ entry: "pg/jsonb@1" }).build();
  return (await db.runtime().query(plan)).map(({ entry }) => entry);
}

export async function scanBranch(db: SessionDatabase, sessionId: string, query: StorageBranchScan): Promise<Entry[]> {
  return await readBranch(db, sessionId, query, false) as unknown as Entry[];
}

export async function scanBranchStructure(db: SessionDatabase, sessionId: string, query: StorageBranchScan): Promise<EntryStructure[]> {
  return await readBranch(db, sessionId, query, true) as unknown as EntryStructure[];
}
