import { resolveListReadOptions, value, type ListElement, type ListReadOptions, type StoredValue,
  type Value, type ValueList } from "@earendil-works/pi-agent-core/harness/session";
import type { SessionDatabase, SessionReader } from "./database.ts";

export async function readValue<T>(db: SessionReader, sessionId: string, address: Value<T>): Promise<StoredValue<T> | undefined> {
  const row = await db.orm.public.PiScalarValue.select("value", "seq").first({ sessionId, namespace: address.namespace, key: address.key });
  return row === null ? undefined : { address, seq: row.seq, value: row.value as T };
}

export async function scanValues<T>(db: SessionDatabase, sessionId: string, prefix: Value<T>): Promise<StoredValue<T>[]> {
  const plan = db.raw.sql`SELECT key, seq, value FROM pi_scalar_values WHERE session_id = ${sessionId}
    AND namespace = ${prefix.namespace} AND starts_with(key, ${prefix.key}) ORDER BY key COLLATE "C"`
    .returnsRow({ key: "pg/text@1", seq: "pg/int8number@1", value: { codecId: "pg/jsonb@1", nullable: true } }).build();
  return (await db.runtime().query(plan)).map((row) => ({ address: value<T>(prefix.namespace, row.key), seq: row.seq, value: row.value as T }));
}

export async function readList<T>(db: SessionReader, sessionId: string, address: ValueList<T>, options: ListReadOptions | undefined): Promise<ListElement<T>[]> {
  const resolved = resolveListReadOptions(options);
  let rows = db.orm.public.PiListValue.where({ sessionId, namespace: address.namespace, key: address.key }).select("seq", "value");
  if (resolved.cursor !== undefined) rows = rows.where((row) => resolved.order === "asc" ? row.seq.gt(resolved.cursor?.seq ?? 0) : row.seq.lt(resolved.cursor?.seq ?? 0));
  return (await rows.orderBy((row) => resolved.order === "asc" ? row.seq.asc() : row.seq.desc()).limit(resolved.limit).all())
    .map((row) => ({ seq: row.seq, value: row.value as T }));
}

export async function readAllValues(db: SessionReader, sessionId: string): Promise<StoredValue<unknown>[]> {
  const rows = await db.orm.public.PiScalarValue.where({ sessionId }).orderBy((row) => row.seq.asc()).all();
  return rows.map((row) => ({ address: value(row.namespace, row.key), seq: row.seq, value: row.value }));
}
