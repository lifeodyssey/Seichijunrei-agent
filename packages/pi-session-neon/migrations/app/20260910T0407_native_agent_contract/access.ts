import { rawSql } from '@prisma/orm-postgres/migration';

export const AGENT_SERVICE_ACCESS = rawSql({
  id: 'agent-service-access',
  label: 'Grant agent service access to native agent tables',
  operationClass: 'additive',
  target: { id: 'postgres' },
  precheck: [{
    description: 'require the existing agent service role',
    sql: "SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_svc') AS result",
  }],
  execute: [{
    description: 'grant mutable session, value and business records',
    sql: 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pi_sessions, public.pi_scalar_values, public.pi_list_values, public.agent_admissions, public.agent_open_operations, public.agent_settlements TO agent_svc',
  }, {
    description: 'grant append-only native entry and usage access',
    sql: 'GRANT SELECT, INSERT ON TABLE public.pi_records TO agent_svc',
  }],
  postcheck: [{
    description: 'verify mutable table access and append-only history',
    sql: "SELECT bool_and(has_table_privilege('agent_svc', name, 'SELECT') AND has_table_privilege('agent_svc', name, 'INSERT') AND has_table_privilege('agent_svc', name, 'UPDATE') AND has_table_privilege('agent_svc', name, 'DELETE')) AND has_table_privilege('agent_svc', 'pi_records', 'SELECT') AND has_table_privilege('agent_svc', 'pi_records', 'INSERT') AND NOT has_table_privilege('agent_svc', 'pi_records', 'UPDATE') AND NOT has_table_privilege('agent_svc', 'pi_records', 'DELETE') AS result FROM unnest(ARRAY['pi_sessions','pi_scalar_values','pi_list_values','agent_admissions','agent_open_operations','agent_settlements']) AS name",
  }],
});
