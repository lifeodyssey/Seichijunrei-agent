// Executable SQL contract examples, not a runtime admission/settlement implementation.
// #1546/#1550 must exercise their real writers and recovery paths against this schema.
import { database } from "./postgres.ts";
import { ADMISSION, DAY, STAMP } from "./business-records.ts";

export const reserve = () => database.raw.sql`
  WITH reserved AS (
    UPDATE agent_admissions SET quota_usage_date = ${DAY}, quota_reserved_at = ${STAMP}
    WHERE id = ${ADMISSION.id} AND state = 'pending' AND quota_reserved_at IS NULL
    RETURNING identity_id, quota_usage_date
  )
  INSERT INTO anon_daily_message_count (usage_date, anon_id, message_count)
  SELECT quota_usage_date, identity_id, 1 FROM reserved
  ON CONFLICT (usage_date, anon_id) DO UPDATE
  SET message_count = anon_daily_message_count.message_count + 1`.affectedCount().build();

export const settle = () => database.raw.sql`
  WITH settled AS (
    UPDATE agent_settlements SET last_usage_seq = 4, settled_at = ${STAMP}
    WHERE operation_id = 'operation' AND settled_at IS NULL
    RETURNING operation_id
  ), refunded AS (
    UPDATE agent_admissions SET state = 'settled', quota_refunded_at = ${STAMP}
    FROM settled WHERE agent_admissions.operation_id = settled.operation_id
      AND quota_reserved_at IS NOT NULL AND quota_refunded_at IS NULL
    RETURNING identity_id, quota_usage_date
  ), quota AS (
    UPDATE anon_daily_message_count SET message_count = message_count - 1
    FROM refunded WHERE anon_id = refunded.identity_id AND usage_date = refunded.quota_usage_date
  )
  INSERT INTO daily_usage (usage_date, scope, requests, input_tokens, output_tokens, cost_usd)
  SELECT ${DAY}::date, 'anon', 1, 1, 2, 0.3 FROM settled
  ON CONFLICT (usage_date, scope) DO UPDATE
  SET requests = daily_usage.requests + 1, input_tokens = daily_usage.input_tokens + 1,
      output_tokens = daily_usage.output_tokens + 2, cost_usd = daily_usage.cost_usd + 0.3`.affectedCount().build();
