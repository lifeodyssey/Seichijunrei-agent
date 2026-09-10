import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { StorageBackedSession, type ForkOptions, type SessionCreateOptions, type SessionMetadata,
  type SessionRepo } from "@earendil-works/pi-agent-core/harness/session";

import type { SessionDatabase } from "./database.ts";
import { persistFork, readForkSnapshot } from "./fork.ts";

import { NEON_STORAGE_VERSION, readMetadata, requireStorageVersion } from "./session-metadata.ts";
import { NeonStorage } from "./storage.ts";

/** Owns open handles; the SDK owns Session behavior and PostgreSQL owns persistence. */
export class NeonSessionRepo implements SessionRepo {
  private readonly db: SessionDatabase;
  private readonly pendingIds = new Set<string>();
  private readonly openStorages = new Map<string, NeonStorage>();

  constructor(db: SessionDatabase) {
    this.db = db;
  }

  async create(options: SessionCreateOptions | undefined, _context: Context): Promise<StorageBackedSession> {
    const id = options?.id ?? crypto.randomUUID();
    this.reserveId(id);
    try {
      const metadata = { id, createdAt: Date.now(), storageVersion: NEON_STORAGE_VERSION,
        ...(options?.parentSessionId === undefined ? {} : { parentSessionId: options.parentSessionId }) };
      await this.db.orm.public.PiSession.create({ id, metadata, nextSeq: 1 });
      return this.openSession(metadata);
    } finally {
      this.pendingIds.delete(id);
    }
  }

  async open(metadata: SessionMetadata, _context: Context): Promise<StorageBackedSession> {
    this.reserveId(metadata.id);
    try {
      return this.openSession(await readMetadata(this.db, metadata.id));
    } finally {
      this.pendingIds.delete(metadata.id);
    }
  }

  async list(_options: undefined, _context: Context): Promise<SessionMetadata[]> {
    const rows = await this.db.orm.public.PiSession.select("metadata").all();
    return rows.map(({ metadata }) => requireStorageVersion(metadata as unknown as SessionMetadata)).sort((a, b) => b.createdAt - a.createdAt);
  }

  async delete(metadata: SessionMetadata, _context: Context): Promise<void> {
    this.reserveId(metadata.id);
    try {
      const row = await this.db.orm.public.PiSession.where({ id: metadata.id }).delete();
      if (row === null) throw new Error(`Unknown session: ${metadata.id}`);
    } finally {
      this.pendingIds.delete(metadata.id);
    }
  }

  async fork(source: SessionMetadata, options: ForkOptions, _context: Context): Promise<StorageBackedSession> {
    const id = options.id ?? crypto.randomUUID();
    this.reserveId(id);
    try {
      const storage = this.openStorages.get(source.id);
      const snapshot = await (storage?.snapshot(options) ?? readForkSnapshot(this.db, source.id, options));
      const metadata = { id, createdAt: Date.now(), storageVersion: NEON_STORAGE_VERSION, parentSessionId: source.id };
      await persistFork(this.db, metadata, snapshot);
      return this.openSession(metadata);
    } finally {
      this.pendingIds.delete(id);
    }
  }

  private openSession(metadata: SessionMetadata): StorageBackedSession {
    const storage = new NeonStorage(this.db, { sessionId: metadata.id });
    this.openStorages.set(metadata.id, storage);
    return new StorageBackedSession(metadata, storage, { onClose: () => { this.openStorages.delete(metadata.id); } });
  }

  private reserveId(id: string): void {
    if (this.pendingIds.has(id) || this.openStorages.has(id)) throw new Error(`Session is already open: ${id}`);
    this.pendingIds.add(id);
  }
}
