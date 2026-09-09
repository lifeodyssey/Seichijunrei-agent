// A concrete native Write[] fixture. Full Storage and locking belong to #1541.
import assert from "node:assert/strict";
import { appendList, list, prepareStorageCommit, setValue, value, validateCommittedWrites } from "@earendil-works/pi-agent-core/harness/session";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import { z } from "zod";
import type { Contract } from "../src/contract.d.ts";
import { entry, USAGE } from "./native-records.ts";
import { database, SESSION_ID } from "./postgres.ts";

export const SCALAR = setValue(value("app", "settings"), { city: "Kyoto" });
export const APPEND = appendList(list("app", "cities"), { city: "Kyoto" });

export async function insertNativeRows(tx: Pick<PostgresClient<Contract>, "orm">, firstSeq: number) {
  const record = entry("entry", firstSeq);
  const usage = { ...USAGE, seq: firstSeq + 3 };
  await tx.orm.public.PiRecord.create({ sessionId: SESSION_ID, id: record.id, seq: record.seq,
    kind: "entry", payload: z.json().parse(JSON.parse(JSON.stringify(record))) });
  await tx.orm.public.PiScalarValue.create({ sessionId: SESSION_ID, namespace: "app", key: "settings", seq: firstSeq + 1, value: { city: "Kyoto" } });
  await tx.orm.public.PiListValue.create({ sessionId: SESSION_ID, namespace: "app", key: "cities", seq: firstSeq + 2, value: { city: "Kyoto" } });
  await tx.orm.public.PiRecord.create({ sessionId: SESSION_ID, id: usage.id, seq: usage.seq,
    kind: "usage", payload: z.json().parse(JSON.parse(JSON.stringify(usage))) });
}

export async function nativeMultiwrite() {
  return database.transaction(async (tx) => {
    const session = await tx.orm.public.PiSession.first({ id: SESSION_ID });
    assert.ok(session);
    const prepared = prepareStorageCommit([{ kind: "entry", entry: entry() }, SCALAR, APPEND, { kind: "usage", row: USAGE }], session.nextSeq, 123);
    validateCommittedWrites(prepared.writes, session.nextSeq, { hasEntryId: () => false, hasEntryOrUsageId: () => false });
    await insertNativeRows(tx, prepared.result.firstSeq);
    await tx.orm.public.PiSession.where((row) => row.id.eq(SESSION_ID)).update({ nextSeq: prepared.result.firstSeq + prepared.writes.length });
    return prepared.result;
  });
}

export function nativeRows() {
  return Promise.all([database.orm.public.PiRecord.all(), database.orm.public.PiScalarValue.all(),
    database.orm.public.PiListValue.all(), database.orm.public.PiSession.select("nextSeq").all()]);
}
