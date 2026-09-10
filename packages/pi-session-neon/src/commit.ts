import { prepareStorageCommit, validateCommittedWrites, type CommittedWrite, type Write } from "@earendil-works/pi-agent-core/harness/session";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";
import type { SessionDatabase, SessionTransaction } from "./database.ts";
import { readSessionStats } from "./session-stats.ts";

function validationIds(writes: CommittedWrite[]): string[] {
  return writes.flatMap((write) => {
    if (write.kind === "entry") return write.parentId === null ? [write.id] : [write.id, write.parentId];
    return write.kind === "usage" ? [write.id] : [];
  });
}

async function validateCommit(tx: SessionTransaction, sessionId: string, writes: CommittedWrite[], firstSeq: number) {
  const ids = validationIds(writes);
  const records = await tx.orm.public.PiRecord.where({ sessionId }).where((row) => row.id.in(ids)).select("id", "kind").all();
  const entryIds = new Set(records.filter(({ kind }) => kind === "entry").map(({ id }) => id));
  const recordIds = new Set(records.map(({ id }) => id));
  validateCommittedWrites(writes, firstSeq, { hasEntryId: (id) => entryIds.has(id), hasEntryOrUsageId: (id) => recordIds.has(id) });
}

async function writeScalar(tx: SessionTransaction, sessionId: string, write: Extract<CommittedWrite, { kind: "value" }>) {
  const address = { sessionId, namespace: write.namespace, key: write.key };
  if (write.op === "delete") return tx.orm.public.PiScalarValue.where(address).delete();
  const stored = { seq: write.seq, value: write.value as JsonValue };
  return tx.orm.public.PiScalarValue.upsert({ create: { ...address, ...stored }, update: stored });
}

async function writeList(tx: SessionTransaction, sessionId: string, write: Extract<CommittedWrite, { kind: "list" }>) {
  const address = { sessionId, namespace: write.namespace, key: write.key };
  if (write.op === "delete") return tx.orm.public.PiListValue.where(address).deleteAll();
  return tx.orm.public.PiListValue.create({ ...address, seq: write.seq, value: write.value as JsonValue });
}

export async function persistWrite(tx: SessionTransaction, sessionId: string, write: CommittedWrite): Promise<unknown> {
  if (write.kind === "value") return writeScalar(tx, sessionId, write);
  if (write.kind === "list") return writeList(tx, sessionId, write);
  const { kind, ...payload } = write;
  return tx.orm.public.PiRecord.create({ sessionId, id: payload.id, seq: payload.seq, kind, payload: payload as unknown as JsonValue });
}

export async function commitWrites(db: SessionDatabase, sessionId: string, writes: Write[], timestamp: number) {
  return db.transaction(async (tx) => {
    const lock = db.raw.sql`SELECT next_seq FROM pi_sessions WHERE id = ${sessionId} FOR UPDATE`.returnsRow({ next_seq: "pg/int8number@1" }).build();
    const [session] = await tx.query(lock);
    if (session === undefined) throw new Error(`Unknown session: ${sessionId}`);
    const prepared = prepareStorageCommit(writes, session.next_seq, timestamp);
    await validateCommit(tx, sessionId, prepared.writes, session.next_seq);
    for (const write of prepared.writes) await persistWrite(tx, sessionId, write);
    await tx.orm.public.PiSession.where({ id: sessionId }).update({ nextSeq: session.next_seq + writes.length });
    return { ...prepared.result, stats: await readSessionStats(db, sessionId, tx) };
  });
}
