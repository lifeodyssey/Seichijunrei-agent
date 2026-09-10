import pg from "pg";
import { expect, vi } from "vitest";

interface Query { query: string; params: unknown[] }
interface Batch { queries: Query[] }

/** Native database cloning keeps each test isolated without replaying Atlas. */
export async function clonePrismaDatabase(serverDsn: string, name: string): Promise<string> {
  const url = new URL(serverDsn);
  url.pathname = "/postgres";
  const admin = new pg.Client(url.toString());
  await admin.connect();
  try { await admin.query(`CREATE DATABASE "${name}" TEMPLATE "native_delivery"`); }
  finally { await admin.end(); }
  url.pathname = `/${name}`;
  return url.toString();
}

async function query(client: pg.Client, statement: Query) {
  return client.query<unknown[]>({ text: statement.query, values: statement.params, rowMode: "array" });
}

async function batch(client: pg.Client, statements: Batch, headers: Headers) {
  const readOnly = headers.get("Neon-Batch-Read-Only") === "true" ? " READ ONLY" : "";
  await client.query(`BEGIN ISOLATION LEVEL REPEATABLE READ${readOnly}`);
  const results = [];
  for (const statement of statements.queries) results.push(await query(client, statement));
  await client.query("COMMIT");
  return { results };
}

/** Replace only Neon HTTP transport; pg executes the SDK's payload unchanged. */
export function servePrismaPostgres(dsn: string): void {
  vi.stubGlobal("fetch", async (_input: unknown, options?: RequestInit) => {
    const headers = new Headers(options?.headers);
    expect(headers.get("Neon-Connection-String")).toBe(dsn);
    return postgresHttp(dsn, headers, options?.body as string);
  });
}

export async function postgresHttp(dsn: string, headers: Headers, body: string): Promise<Response> {
  const statement = JSON.parse(body) as Query | Batch;
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    const result = "queries" in statement ? await batch(client, statement, headers) : await query(client, statement);
    return Response.json(result);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof pg.DatabaseError) return Response.json({ code: error.code, message: error.message }, { status: 400 });
    throw error;
  } finally { await client.end(); }
}
