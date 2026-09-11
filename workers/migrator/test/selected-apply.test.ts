import { afterEach, describe, expect, it, vi } from "vitest";
import { applySelectedChain } from "../src/selected-apply";
import { FakeSql } from "./fake-sql";
import { REFUSAL_CASES } from "./preflight.cases";
import { HASH_A, metadata, revision, serveLedger } from "./preflight-fixtures";
import { selectedInput, selectedMetadata } from "./selected-apply-fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("selected chain execution after taking the apply lock", () => {
  it("applies only B after a native read-only comparison of completed A", async () => {
    const transport = serveLedger([revision()]);
    const db = new FakeSql();
    db.alreadyApplied("20260101000000");
    expect(await applySelectedChain(selectedInput(db), selectedMetadata())).toEqual({ kind: "success", exitCode: 0 });
    expect(db.committed).toEqual(["ALTER TABLE public.preflight_example ADD COLUMN label text;"]);
    const headers = new Headers(transport.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Neon-Batch-Read-Only")).toBe("true");
    expect(headers.get("Neon-Batch-Isolation-Level")).toBe("RepeatableRead");
  });

  it.each(REFUSAL_CASES)("refuses $name before entering the SQL apply", async ({ rows, error }) => {
    serveLedger(rows);
    const db = new FakeSql();
    expect(await applySelectedChain(selectedInput(db), selectedMetadata())).toEqual({ kind: "refused", reason: error });
    expect(db.statements).toEqual([]);
    expect(db.transactions).toEqual([]);
  });

  it("refuses checksum substitution before even reading the database", async () => {
    const transport = serveLedger([revision()]);
    const body = { ...metadata, atlasSum: metadata.atlasSum.replace(HASH_A, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=") };
    expect(await applySelectedChain(selectedInput(new FakeSql()), selectedMetadata(body)))
      .toEqual({ kind: "refused", reason: "bundle_checksum_mismatch" });
    expect(transport).not.toHaveBeenCalled();
  });

});

describe("selected chain failures", () => {
  it("refuses a missing ledger without creating one", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ message: "fixture missing", code: "42P01" }, { status: 400 })));
    const db = new FakeSql();
    expect(await applySelectedChain(selectedInput(db), selectedMetadata())).toEqual({ kind: "refused", reason: "ledger_missing" });
    expect(db.ledgerExists).toBe(false);
  });

  it("rejects a pooled endpoint before the compatibility read or SQL apply", async () => {
    const transport = serveLedger([revision()]);
    const db = new FakeSql();
    const input = { ...selectedInput(db), dsn: "postgresql://fixture:fixture@ep-fixture-pooler.neon.tech/neondb" };
    expect(await applySelectedChain(input, selectedMetadata()))
      .toEqual({ kind: "failure", exitCode: 1, error: "migration_unavailable" });
    expect(transport).not.toHaveBeenCalled();
    expect(db.statements).toEqual([]);
  });

  it("sanitizes an unexpected native database failure", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("password=fixture")));
    expect(await applySelectedChain(selectedInput(new FakeSql()), selectedMetadata()))
      .toEqual({ kind: "failure", exitCode: 1, error: "migration_unavailable" });
  });

  it("sanitizes a failed SQL apply after a compatible read", async () => {
    serveLedger([revision()]);
    const db = new FakeSql();
    db.alreadyApplied("20260101000000");
    db.failBody = "ALTER TABLE public.preflight_example ADD COLUMN label text;";
    expect(await applySelectedChain(selectedInput(db), selectedMetadata()))
      .toEqual({ kind: "failure", exitCode: 1, error: "migration_failed" });
    expect(db.committed).toEqual([]);
  });
});
