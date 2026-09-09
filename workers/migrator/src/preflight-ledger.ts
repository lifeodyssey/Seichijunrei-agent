import { neon } from "@neondatabase/serverless";

/** Native transaction options reach Neon HTTP; no apply, DDL, or write lock. */
export async function readRevisionSnapshot(dsn: string): Promise<unknown> {
  const sql = neon(dsn);
  const [rows]: unknown[] = await sql.transaction([
    sql`SELECT version, description, type::text, applied::text, total::text, hash, error
        FROM public.atlas_schema_revisions ORDER BY version`,
  ], { readOnly: true, isolationLevel: "RepeatableRead" });
  return rows;
}
