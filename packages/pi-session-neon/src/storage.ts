import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { EntryScan, ForkOptions, ListReadOptions, Storage, StorageBranchScan, UsageScan, Value, ValueList, Write } from "@earendil-works/pi-agent-core/harness/session";
import { scanBranch, scanBranchStructure } from "./branch-entries.ts";
import { commitWrites } from "./commit.ts";
import type { SessionDatabase } from "./database.ts";
import { readEntries, scanEntries, scanUsage } from "./entries.ts";
import { readForkSnapshot } from "./fork.ts";
import { readSessionStats } from "./session-stats.ts";
import { readList, readValue, scanValues } from "./values.ts";

export interface NeonStorageOptions {
  sessionId: string;
}

/** One SDK Storage handle; PostgreSQL owns durable state and commit atomicity. */
export class NeonStorage implements Storage {
  private readonly db: SessionDatabase;
  private readonly sessionId: string;
  private commits: Promise<void> = Promise.resolve();
  private closing: Promise<void> | undefined;

  constructor(db: SessionDatabase, options: NeonStorageOptions) {
    this.db = db;
    this.sessionId = options.sessionId;
  }

  async commit(writes: Write[], _context: Context) {
    return this.admit(() => commitWrites(this.db, this.sessionId, writes, Date.now()));
  }

  async getEntries(ids: string[], _context: Context) {
    this.assertOpen();
    return readEntries(this.db, this.sessionId, ids);
  }

  snapshot(options: ForkOptions) {
    return this.admit(() => readForkSnapshot(this.db, this.sessionId, options));
  }

  async getValue<T>(address: Value<T>, _context: Context) {
    this.assertOpen();
    return readValue(this.db, this.sessionId, address);
  }

  async scanValues<T>(prefix: Value<T>, _context: Context) {
    this.assertOpen();
    return scanValues(this.db, this.sessionId, prefix);
  }

  async readList<T>(address: ValueList<T>, options: ListReadOptions | undefined, _context: Context) {
    this.assertOpen();
    return readList(this.db, this.sessionId, address, options);
  }

  async scanBranch(query: StorageBranchScan, _context: Context) {
    this.assertOpen();
    return scanBranch(this.db, this.sessionId, query);
  }

  async scanBranchStructure(query: StorageBranchScan, _context: Context) {
    this.assertOpen();
    return scanBranchStructure(this.db, this.sessionId, query);
  }

  async scanEntries(query: EntryScan, _context: Context) {
    this.assertOpen();
    return scanEntries(this.db, this.sessionId, query);
  }

  async scanUsage(query: UsageScan, _context: Context) {
    this.assertOpen();
    return scanUsage(this.db, this.sessionId, query);
  }

  async getStats(_context: Context) {
    this.assertOpen();
    return readSessionStats(this.db, this.sessionId);
  }

  close(_context: Context): Promise<void> {
    this.closing ??= this.commits;
    return this.closing;
  }

  private admit<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const result = this.commits.then(operation);
    this.commits = result.then(() => undefined, () => undefined);
    return result;
  }

  private assertOpen(): void {
    if (this.closing !== undefined) throw new Error("NeonStorage is closed");
  }
}
