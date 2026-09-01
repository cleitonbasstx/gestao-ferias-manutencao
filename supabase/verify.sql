-- Read-only verification of the deployed schema and API permissions.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
  has_table_privilege('anon',c.oid,'SELECT') as anonymous_read,
  has_table_privilege('authenticated',c.oid,'SELECT') as direct_authenticated_read
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r'
order by c.relname;

select p.proname as function_name,
  has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('get_shared_state','apply_mutation','registry_key')
order by p.proname;

select (select count(*) from public.collaborators) as collaborators,
       (select count(*) from public.vacation_periods) as vacation_periods,
       (select revision from public.app_metadata where id) as revision;
