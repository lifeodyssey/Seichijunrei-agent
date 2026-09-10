import type { SessionStats } from "@earendil-works/pi-agent-core/harness/session";
import type { SessionDatabase, SessionTransaction } from "./database.ts";

function usageTotal(db: SessionDatabase, field: string) {
  return db.raw.sql`sum((payload #>> ${`{usage,${field}}`}::text[])::double precision ORDER BY seq)`
    .returns({ codecId: "pg/float8@1", nullable: true });
}

function requiredUsageTotal(db: SessionDatabase, field: string) {
  return db.raw.sql`coalesce(${usageTotal(db, field)}, 0::double precision)`.returns("pg/float8@1");
}

export async function readSessionStats(db: SessionDatabase, sessionId: string, runtime: Pick<SessionTransaction, "query"> = db.runtime()): Promise<SessionStats> {
  const plan = db.raw.sql`SELECT jsonb_build_object(
    'messageCount', (SELECT count(*) FROM pi_records WHERE session_id = ${sessionId} AND kind = 'entry' AND payload->>'type' = 'message'),
    'usage', jsonb_strip_nulls(jsonb_build_object(
      'input', ${requiredUsageTotal(db, "input")}, 'output', ${requiredUsageTotal(db, "output")},
      'cacheRead', ${requiredUsageTotal(db, "cacheRead")}, 'cacheWrite', ${requiredUsageTotal(db, "cacheWrite")},
      'cacheWrite1h', ${usageTotal(db, "cacheWrite1h")}, 'reasoning', ${usageTotal(db, "reasoning")},
      'totalTokens', ${requiredUsageTotal(db, "totalTokens")},
      'cost', jsonb_build_object('input', ${requiredUsageTotal(db, "cost,input")},
        'output', ${requiredUsageTotal(db, "cost,output")}, 'cacheRead', ${requiredUsageTotal(db, "cost,cacheRead")},
        'cacheWrite', ${requiredUsageTotal(db, "cost,cacheWrite")}, 'total', ${requiredUsageTotal(db, "cost,total")})
    ))) AS stats FROM pi_records WHERE session_id = ${sessionId} AND kind = 'usage'`
    .returnsRow({ stats: "pg/jsonb@1" }).build();
  const [row] = await runtime.query(plan);
  if (row === undefined) throw new Error("Session statistics query returned no aggregate");
  return row.stats as unknown as SessionStats;
}
