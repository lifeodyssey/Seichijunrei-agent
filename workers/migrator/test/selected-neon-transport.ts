import { Response as WorkerResponse, type Request as WorkerRequest } from "miniflare";
import { COLUMN_NAMES, type RevisionFixture } from "./preflight-fixtures";

interface Query { query: string; params: string[] }
interface QueryBatch { queries: Query[] }

export interface SelectedLedger {
  rows: RevisionFixture[] | null;
  statements: string[];
  headers: Headers[];
  failNextTransaction?: boolean;
}

function result(rows: readonly unknown[][], columns: readonly string[]) {
  return { fields: columns.map((name) => ({ name, dataTypeID: 25 })), rows };
}

function recordRevision(db: SelectedLedger, params: string[]): void {
  const [version, description, applied, , , error, , hash] = params;
  if (!version || !description || !hash || applied === undefined) throw new Error("invalid test revision");
  const row = { version, description, type: "2", applied, total: "1", hash, error: error ?? null };
  db.rows = [...(db.rows ?? []).filter((entry) => entry.version !== version), row];
}

function queryResult(db: SelectedLedger, query: Query) {
  const rows = db.rows ?? [];
  if (query.query.includes("type::text")) return result(rows.map(Object.values), COLUMN_NAMES);
  if (query.query.includes("DESC LIMIT 1")) return result(rows.slice(-1).map(({ version, description }) => [version, description]), ["version", "description"]);
  if (query.query.includes("applied >= total")) return result(rows.filter((row) => row.applied === row.total).map(({ version }) => [version]), ["version"]);
  if (query.query.includes("applied < total")) return result(rows.filter((row) => row.applied !== row.total).map(({ version, hash }) => [version, hash]), ["version", "hash"]);
  if (query.query.startsWith("INSERT INTO public.atlas_schema_revisions")) recordRevision(db, query.params);
  return result([], []);
}

function execute(db: SelectedLedger, query: Query) {
  db.statements.push(query.query);
  return queryResult(db, query);
}

async function sqlResponse(db: SelectedLedger, request: WorkerRequest): Promise<WorkerResponse> {
  const body = await request.json() as Query | QueryBatch;
  const queries = "queries" in body ? body.queries : [body];
  db.headers.push(new Headers(request.headers));
  if (db.rows === null && queries.some(({ query }) => query.includes("type::text"))) {
    return WorkerResponse.json({ message: "fixture ledger missing", code: "42P01" }, { status: 400 });
  }
  if (db.failNextTransaction && "queries" in body && request.headers.get("Neon-Batch-Read-Only") !== "true") {
    db.failNextTransaction = false;
    return WorkerResponse.json({ message: "fixture SQL failure password=fixture", code: "XX000" }, { status: 400 });
  }
  const results = [];
  for (const query of queries) results.push(execute(db, query));
  return WorkerResponse.json("queries" in body ? { results } : results[0]);
}

export function selectedTransport(db: SelectedLedger) {
  return (request: WorkerRequest) => sqlResponse(db, request);
}
