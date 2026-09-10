import { checkExpression, col, lit, primaryKey } from '@prisma/orm-postgres/migration';

export const NATIVE_TABLES = [{
  schema: 'public', table: 'pi_list_values',
  columns: [
    col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('namespace', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('seq', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8number@1' } }),
    col('session_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('value', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
  ],
  constraints: [primaryKey(['session_id', 'namespace', 'key', 'seq'])],
}, {
  schema: 'public', table: 'pi_records',
  columns: [
    col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('payload', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
    col('seq', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8number@1' } }),
    col('session_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
  ],
  constraints: [
    primaryKey(['session_id', 'id']),
    checkExpression('pi_records_kind_check_a2fad22d', "\"kind\" IN ('entry', 'usage')"),
    checkExpression('pi_records_payload_id_94d9123f', "(payload->>'id') IS NOT DISTINCT FROM id"),
    checkExpression('pi_records_payload_seq_9ea7b271', "((payload->>'seq')::bigint) IS NOT DISTINCT FROM seq"),
  ],
}, {
  schema: 'public', table: 'pi_scalar_values',
  columns: [
    col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('namespace', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('seq', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8number@1' } }),
    col('session_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('value', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
  ],
  constraints: [primaryKey(['session_id', 'namespace', 'key'])],
}, {
  schema: 'public', table: 'pi_sessions',
  columns: [
    col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('metadata', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
    col('next_seq', 'int8', { notNull: true, default: lit(0), codecRef: { codecId: 'pg/int8number@1' } }),
  ],
  constraints: [
    primaryKey(['id']),
    checkExpression('pi_sessions_metadata_id_d12aedca', "(metadata->>'id') IS NOT DISTINCT FROM id"),
    checkExpression('pi_sessions_next_seq_4a7f17e3', 'next_seq >= 0'),
  ],
}] as const;
