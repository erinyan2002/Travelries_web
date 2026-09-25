-- Read-only RLS / security audit. Changes nothing.
-- Run in the Supabase SQL editor and copy the single JSON result cell.
-- (Also a snapshot of the live schema, since the original tables were created
-- in the dashboard and have no migration file in supabase/migrations.)

select jsonb_pretty(jsonb_build_object(

  -- 1. Public tables and whether RLS is on (off = anyone with the anon key can read/write).
  'tables', (
    select jsonb_agg(jsonb_build_object('table', c.relname, 'rls_enabled', c.relrowsecurity) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  ),

  -- 2. Every policy: who it applies to, for which command, and its conditions.
  'policies', (
    select jsonb_agg(jsonb_build_object(
      'table', tablename, 'policy', policyname, 'command', cmd, 'roles', roles,
      'using', qual, 'with_check', with_check) order by tablename, policyname)
    from pg_policies where schemaname = 'public'
  ),

  -- 3. Columns per table (schema snapshot).
  'columns', (
    select jsonb_object_agg(table_name, cols) from (
      select table_name, jsonb_agg(column_name || ' ' || data_type || case when is_nullable = 'NO' then ' not null' else '' end
                                   order by ordinal_position) as cols
      from information_schema.columns where table_schema = 'public' group by table_name
    ) t
  ),

  -- 4. Functions (RPCs, triggers), incl. whether they bypass RLS (security definer).
  'functions', (
    select jsonb_agg(jsonb_build_object(
      'name', p.proname, 'security_definer', p.prosecdef, 'definition', pg_get_functiondef(p.oid)) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  ),

  -- 5. Triggers on public tables.
  'triggers', (
    select jsonb_agg(jsonb_build_object('table', event_object_table, 'trigger', trigger_name,
                                        'event', event_manipulation, 'action', action_statement))
    from information_schema.triggers where trigger_schema = 'public'
  ),

  -- 6. Storage buckets and storage policies.
  'buckets', (select jsonb_agg(jsonb_build_object('id', id, 'public', public)) from storage.buckets),
  'storage_policies', (
    select jsonb_agg(jsonb_build_object('policy', policyname, 'command', cmd, 'roles', roles,
                                        'using', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'storage'
  )
)) as audit;
