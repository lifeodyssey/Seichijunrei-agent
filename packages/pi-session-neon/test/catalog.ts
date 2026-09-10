export const TABLE_CATALOG = `
  SELECT c.relname AS name, c.relacl::text AS grants,
    (SELECT jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod),
      a.attnotnull, pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attnum)
     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
    (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname)
     FROM pg_constraint WHERE conrelid = c.oid) AS constraints,
    (SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid::regclass::text)
     FROM pg_index WHERE indrelid = c.oid) AS indexes,
    (SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname)
     FROM pg_trigger WHERE tgrelid = c.oid AND NOT tgisinternal) AS triggers
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'atlas_schema_revisions'
  ORDER BY c.relname`;

export interface TableShape {
  name: string;
  grants: string | null;
  columns: unknown;
  constraints: unknown;
  indexes: unknown;
  triggers: unknown;
}
