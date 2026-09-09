import type pg from "pg";

/** Mirror Neon's inherited administrative group without PostgreSQL SUPERUSER. */
export async function migratorRole(client: pg.Client, dsn: string): Promise<string> {
  await client.query("CREATE ROLE neon_superuser NOLOGIN NOSUPERUSER; CREATE ROLE migrator LOGIN INHERIT NOSUPERUSER PASSWORD 'local-test-only'; GRANT neon_superuser TO migrator");
  await client.query("GRANT USAGE, CREATE ON SCHEMA public TO neon_superuser; GRANT ALL ON ALL TABLES IN SCHEMA public TO neon_superuser");
  const url = new URL(dsn);
  url.username = "migrator";
  url.password = "local-test-only";
  return url.toString();
}

export function grantDatabaseCreate(client: pg.Client, dsn: string) {
  const database = new URL(dsn).pathname.slice(1);
  return client.query(`GRANT CREATE ON DATABASE "${database}" TO neon_superuser`);
}
