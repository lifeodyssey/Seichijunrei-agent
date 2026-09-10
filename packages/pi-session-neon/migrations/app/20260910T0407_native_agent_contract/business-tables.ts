import { checkExpression, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export const BUSINESS_TABLES = [{
  schema: 'public', table: 'agent_admissions',
  columns: [
    col('client_message_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('created_at', 'timestamptz', { notNull: true, default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('id', 'uuid', { notNull: true, default: fn('uuidv7()'), codecRef: { codecId: 'pg/uuid@1' } }),
    col('identity_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('operation_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('payer', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('quota_refunded_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('quota_reserved_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('quota_usage_date', 'date', { codecRef: { codecId: 'pg/date-string@1' } }),
    col('rejection_reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('request_digest', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('session_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('state', 'text', { notNull: true, default: lit('pending'), codecRef: { codecId: 'pg/text@1' } }),
  ],
  constraints: [
    primaryKey(['id']),
    checkExpression('agent_admissions_anon_reservation_6033223e', "quota_reserved_at IS NULL OR (payer = 'anon' AND kind = 'model')"),
    checkExpression('agent_admissions_kind_c9a3d3de', "kind IN ('model', 'selection')"),
    checkExpression('agent_admissions_operation_eb16a5ca', "(kind = 'model') = (operation_id IS NOT NULL)"),
    checkExpression('agent_admissions_payer_e16f03f2', "payer IN ('anon', 'user', 'byok')"),
    checkExpression('agent_admissions_refund_01ca6412', 'quota_refunded_at IS NULL OR quota_reserved_at IS NOT NULL'),
    checkExpression('agent_admissions_reservation_703b91eb', '(quota_usage_date IS NULL) = (quota_reserved_at IS NULL)'),
    checkExpression('agent_admissions_state_68032317', "state IN ('pending', 'accepted', 'settled', 'void')"),
  ],
}, {
  schema: 'public', table: 'agent_open_operations',
  columns: [
    col('created_at', 'timestamptz', { notNull: true, default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('operation_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
  ],
  constraints: [primaryKey(['operation_id'])],
}, {
  schema: 'public', table: 'agent_settlements',
  columns: [
    col('last_usage_seq', 'int8', { notNull: true, default: lit(-1), codecRef: { codecId: 'pg/int8number@1' } }),
    col('operation_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('settled_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
  ],
  constraints: [primaryKey(['operation_id']), checkExpression('agent_settlements_last_usage_seq_6e9ae59f', 'last_usage_seq >= -1')],
}] as const;
