import { createForkSnapshot, validateCommittedWrites, type CommittedWrite, type ForkOptions, type SessionMetadata } from "@earendil-works/pi-agent-core/harness/session";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";
import type { SessionDatabase } from "./database.ts";
import { persistWrite } from "./commit.ts";
import { scanEntries } from "./entries.ts";
import { readMetadata } from "./session-metadata.ts";
import { readAllValues } from "./values.ts";

export async function readForkSnapshot(db: SessionDatabase, sessionId: string, options: ForkOptions) {
  return db.transaction(async (tx) => {
    await tx.execute(db.raw.sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`.affectedCount().build());
    await readMetadata(tx, sessionId);
    const entries = await scanEntries(db, sessionId, { order: "asc" }, tx);
    const scalarValues = await readAllValues(tx, sessionId);
    return createForkSnapshot({ entries, scalarValues, entriesComplete: true }, options);
  });
}

function forkWrites(snapshot: ReturnType<typeof createForkSnapshot>): CommittedWrite[] {
  const entries: CommittedWrite[] = [...snapshot.entries.values()].map((entry) => ({ kind: "entry", ...entry }));
  const values: CommittedWrite[] = snapshot.scalarValues.map((stored) => ({ ...stored.address, op: "set", seq: stored.seq, value: stored.value }));
  return [...entries, ...values].sort((left, right) => left.seq - right.seq);
}

export async function persistFork(db: SessionDatabase, metadata: SessionMetadata, snapshot: ReturnType<typeof createForkSnapshot>): Promise<void> {
  const writes = forkWrites(snapshot);
  validateCommittedWrites(writes, 0, { hasEntryId: () => false, hasEntryOrUsageId: () => false });
  await db.transaction(async (tx) => {
    await tx.orm.public.PiSession.create({ id: metadata.id, metadata: metadata as unknown as JsonValue, nextSeq: snapshot.nextSeq });
    for (const write of writes) await persistWrite(tx, metadata.id, write);
  });
}
