import { vi } from "vitest";
import { parsePreflightMetadata } from "../src/preflight-metadata";
import { requestMetadata } from "./integration/prisma-fixture";
import { COLUMN_NAMES } from "./preflight-fixtures";

/** Simulate only Neon HTTP responses; the production SDK parses each response. */
export function serveSelectedLedger() {
  const entries = parsePreflightMetadata(JSON.stringify(requestMetadata))?.entries ?? [];
  const rows = entries.map((entry) => [entry.version, entry.description, "2", "1", "1", entry.hash, null]);
  const fields = COLUMN_NAMES.map((name) => ({ name, dataTypeID: 25 }));
  vi.stubGlobal("fetch", vi.fn((_input: unknown, options?: RequestInit) => {
    const body = options?.body as string;
    const result = { fields, rows: body.includes("ORDER BY version DESC") ? [...rows].reverse() : rows };
    return Promise.resolve(Response.json(body.includes('"queries"') ? { results: [result] } : result));
  }));
}
