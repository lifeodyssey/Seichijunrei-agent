export const UNIQUE_CONSTRAINTS = [{
  schema: 'public', table: 'agent_admissions', constraint: 'agent_admissions_operation_id_key', columns: ['operation_id'],
}, {
  schema: 'public', table: 'agent_admissions', constraint: 'agent_admissions_session_id_client_message_id_key', columns: ['session_id', 'client_message_id'],
}, {
  schema: 'public', table: 'pi_records', constraint: 'pi_records_session_id_seq_key', columns: ['session_id', 'seq'],
}] as const;

export const INDEXES = [{
  schema: 'public', table: 'agent_admissions', index: 'agent_admissions_unresolved_4731a1b2',
  columns: ['kind', 'created_at'], extras: { where: "state IN ('pending', 'accepted')" },
}, {
  schema: 'public', table: 'agent_settlements', index: 'agent_settlements_unsettled_3325215f',
  columns: ['operation_id'], extras: { where: 'settled_at IS NULL' },
}] as const;

export const FOREIGN_KEYS = [{
  schema: 'public', table: 'agent_admissions',
  foreignKey: { name: 'agent_admissions_session_id_fkey', columns: ['session_id'],
    references: { schema: 'public', table: 'pi_sessions', columns: ['id'] }, onDelete: 'cascade' },
}, {
  schema: 'public', table: 'agent_open_operations',
  foreignKey: { name: 'agent_open_operations_operation_id_fkey', columns: ['operation_id'],
    references: { schema: 'public', table: 'agent_admissions', columns: ['operation_id'] }, onDelete: 'cascade' },
}, {
  schema: 'public', table: 'agent_settlements',
  foreignKey: { name: 'agent_settlements_operation_id_fkey', columns: ['operation_id'],
    references: { schema: 'public', table: 'agent_admissions', columns: ['operation_id'] }, onDelete: 'cascade' },
}, {
  schema: 'public', table: 'pi_list_values',
  foreignKey: { name: 'pi_list_values_session_id_fkey', columns: ['session_id'],
    references: { schema: 'public', table: 'pi_sessions', columns: ['id'] }, onDelete: 'cascade' },
}, {
  schema: 'public', table: 'pi_records',
  foreignKey: { name: 'pi_records_session_id_fkey', columns: ['session_id'],
    references: { schema: 'public', table: 'pi_sessions', columns: ['id'] }, onDelete: 'cascade' },
}, {
  schema: 'public', table: 'pi_scalar_values',
  foreignKey: { name: 'pi_scalar_values_session_id_fkey', columns: ['session_id'],
    references: { schema: 'public', table: 'pi_sessions', columns: ['id'] }, onDelete: 'cascade' },
}] as const;
