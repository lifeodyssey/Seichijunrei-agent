import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APPLY_LOCK_NAME, productionApply, QueueLock } from "../src/lock";
import type { PreflightMetadata } from "../src/preflight-metadata";
import { selectedMetadata } from "./selected-apply-fixtures";
import type { ContainerOutcome } from "../src/migration";
import { FakeSql } from "./fake-sql";
import { BODY_A, BODY_B, applyFixture } from "./http-apply.helpers";

// #1124 AC4 — second concurrent run waits on a fake lock (no wall clock)
// and does not double-apply. Production lock name is fixed, not migrator-job-*.

describe("HTTP apply mutex (AC4)", () => {
  it("queues a second run so each file is applied once", async () => {
    const db = new FakeSql();
    const lock = new QueueLock();
    let release: () => void = () => undefined;
    db.holdOn(BODY_A, new Promise<void>((resolve) => { release = resolve; }));
    const first = applyFixture(db, { lock });
    const second = applyFixture(db, { lock });
    release();
    await Promise.all([first, second]);
    expect(db.units).toEqual([BODY_A, BODY_B]);
  });

  it("uses a fixed-name apply lock, not a per-run migrator-job-* name", () => {
    const { namespace, calls } = makeLockNamespace();
    productionApply(namespace);
    expect(calls.names).toEqual([APPLY_LOCK_NAME]);
    expect(APPLY_LOCK_NAME).not.toMatch(/^migrator-job-/);
  });

  it("MigratorApplyLock serializes with blockConcurrencyWhile", () => {
    const source = applyLockSource();
    expect(source).toContain("blockConcurrencyWhile");
    expect(source).not.toMatch(/migrator-job-/);
  });

  it("MigratorApplyLock extends DurableObject so stub.run RPC is enabled", () => {
    const source = applyLockSource();
    expect(source).toContain('from "cloudflare:workers"');
    expect(source).toMatch(/class MigratorApplyLock extends DurableObject/);
  });
});

// The head bounds the PRODUCTION apply only if this hop carries it: every other
// bound test drives the injected `workerHttpDeps` double, and `stub.run(dsn, null)`
// type-checks — it would silently apply the whole carried chain again.
describe("the production apply hop", () => {
  it("hands the entire selected chain to the lock", async () => {
    const { namespace, calls } = makeLockNamespace();
    const apply = productionApply(namespace);
    const selection = selectedMetadata();
    await apply("dsn", selection);
    expect(calls.runs).toEqual([["dsn", selection]]);
  });
});

/** What the lock namespace was asked for: the resolved name, then every run RPC. */
interface LockCalls {
  names: string[];
  runs: [string, PreflightMetadata][];
}

function makeLockNamespace(): { namespace: DurableObjectNamespace; calls: LockCalls } {
  const calls: LockCalls = { names: [], runs: [] };
  const run = (...args: [string, PreflightMetadata]): Promise<ContainerOutcome> => {
    calls.runs.push(args);
    return Promise.resolve({ kind: "success", exitCode: 0 });
  };
  const namespace = {
    idFromName: (name: string): string => {
      calls.names.push(name);
      return name;
    },
    get: () => ({ run }),
  } as unknown as DurableObjectNamespace;
  return { namespace, calls };
}

function applyLockSource(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/apply-lock.ts"), "utf8");
}
