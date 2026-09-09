import { afterEach, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import { metadata, revision } from "./preflight-fixtures";
import { selectedWorker } from "./selected-workerd";
import { selectedTransport, type SelectedLedger } from "./selected-neon-transport";

let runtime: Miniflare | undefined;
afterEach(async () => { await runtime?.dispose(); });
const production = { environment: undefined, sub: "repo:lifeodyssey/animichi:environment:production" };

describe("selected apply request boundaries", () => {
  it("keeps legitimate production subjects without an environment claim", async () => {
    const db: SelectedLedger = { rows: [revision()], statements: [], headers: [] };
    const worker = await selectedWorker(selectedTransport(db), production, "production");
    runtime = worker.runtime;
    const response = await worker.request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
  });

  it("requires main independently of the production environment subject", async () => {
    const db: SelectedLedger = { rows: [revision()], statements: [], headers: [] };
    const worker = await selectedWorker(selectedTransport(db), { ...production, ref: "refs/heads/feature" }, "production");
    runtime = worker.runtime;
    const response = await worker.request();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(db.statements).toEqual([]);
  });

  it("refuses a production staging-only baseline before querying", async () => {
    const db: SelectedLedger = { rows: [revision()], statements: [], headers: [] };
    const worker = await selectedWorker(selectedTransport(db), production, "production");
    runtime = worker.runtime;
    const response = await worker.request("/migrate", { ...metadata, stagingOnlyBaseline: true });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "staging_only_baseline" });
    expect(db.statements).toEqual([]);
  });

  it("bounds the authenticated request body using Hono", async () => {
    const db: SelectedLedger = { rows: [revision()], statements: [], headers: [] };
    const worker = await selectedWorker(selectedTransport(db));
    runtime = worker.runtime;
    const response = await worker.request("/migrate", { ...metadata, atlasSum: "a".repeat(65_536) });
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "invalid_migration" });
    expect(db.statements).toEqual([]);
  });
});
