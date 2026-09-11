import { afterEach, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import { selectedWorker } from "./selected-workerd";
import { selectedTransport, type SelectedLedger } from "./selected-neon-transport";
import { HASH_A, HASH_B, metadata, revision } from "./preflight-fixtures";

let runtime: Miniflare | undefined;
afterEach(async () => { await runtime?.dispose(); });

describe("selected apply through the actual Durable Object", () => {
  it("refuses a missing ledger before the old apply can create it", async () => {
    const db: SelectedLedger = { rows: null, statements: [], headers: [] };
    const worker = await selectedWorker(selectedTransport(db));
    runtime = worker.runtime;
    const response = await worker.request();
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "ledger_missing" });
    expect(db.statements.filter((statement) => !statement.startsWith("SELECT"))).toEqual([]);
  });

  it("rechecks the full ledger when the database advances after preflight", async () => {
    const db: SelectedLedger = { rows: [revision()], statements: [], headers: [] };
    const worker = await selectedWorker(selectedTransport(db));
    runtime = worker.runtime;
    const preview = await worker.request("/preflight");
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ compatible: true });
    db.rows = [revision(), revision({ version: "20260102000000", description: "extend", hash: HASH_B }),
      revision({ version: "20260103000000", description: "third", hash: "MPcmhuB/hUj4IZMQuEjGXEJ5ToJyeeb68QjvJp70uIw=" })];
    const response = await worker.request();
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "database_ahead" });
    expect(db.statements.filter((statement) => !statement.startsWith("SELECT"))).toEqual([]);
  });

  it("binds the selected metadata to the carried migration prefix", async () => {
    const alteredHash = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const db: SelectedLedger = { rows: [revision({ hash: alteredHash })], statements: [], headers: [] };
    const worker = await selectedWorker(selectedTransport(db));
    runtime = worker.runtime;
    const response = await worker.request("/migrate", { ...metadata, atlasSum: metadata.atlasSum.replace(HASH_A, alteredHash) });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "bundle_checksum_mismatch" });
    expect(db.statements.filter((statement) => !statement.startsWith("SELECT"))).toEqual([]);
  });
});
