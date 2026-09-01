-- New, empty test database only. No employee data or credentials belong here.
begin;

create table public.managers (
  key text primary key,
  name text not null unique check (length(trim(name)) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.sectors (like public.managers including all);
create table public.collaborators (
  id text primary key,
  employee_id text not null check (length(trim(employee_id)) between 1 and 80),
  name text not null check (length(trim(name)) between 1 and 240),
  role text not null check (length(trim(role)) between 1 and 240),
  manager_key text not null references public.managers(key) on update cascade on delete restrict,
  sector_key text not null references public.sectors(key) on update cascade on delete restrict,
  admission date,
  status text not null check (status in ('Ativo', 'Afastado', 'A REVISAR')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index collaborators_manager on public.collaborators(manager_key);
create index collaborators_sector on public.collaborators(sector_key);
create index collaborators_role on public.collaborators(role);
create table public.vacation_periods (
  id bigint generated always as identity primary key,
  collaborator_id text not null references public.collaborators(id) on update cascade on delete cascade,
  cycle integer not null check (cycle in (1,2)),
  start_date date not null,
  end_date date not null,
  days integer generated always as (end_date - start_date + 1) stored,
  invalid boolean generated always as (end_date < start_date) stored,
  status text not null check (status in ('Planejada','Solicitada','Aprovada','Programada','Realizada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(collaborator_id, cycle)
);
create index vacation_dates on public.vacation_periods(start_date,end_date);
create table public.app_metadata (
  id boolean primary key default true check (id),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.app_metadata(id) values (true);
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  action text not null,
  entity_id text,
  created_at timestamptz not null default now()
);

alter table public.managers enable row level security;
alter table public.sectors enable row level security;
alter table public.collaborators enable row level security;
alter table public.vacation_periods enable row level security;
alter table public.app_metadata enable row level security;
alter table public.audit_log enable row level security;
revoke all on public.managers,public.sectors,public.collaborators,public.vacation_periods,public.app_metadata,public.audit_log from anon,authenticated;

create function public.registry_key(value text, kind text default 'sector') returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(translate(lower(trim(value)),
    'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '\s+', ' ', 'g'),
    case when kind='manager' then '^gestao\s+' else '$^' end, '');
$$;
revoke all on function public.registry_key(text,text) from public,anon,authenticated;

create function public.get_shared_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Login obrigatório' using errcode='42501'; end if;
  select jsonb_build_object(
    'revision', (select revision from public.app_metadata where id),
    'registries', jsonb_build_object(
      'managers', coalesce((select jsonb_agg(jsonb_build_object('key',key,'name',name) order by name) from public.managers),'[]'::jsonb),
      'sectors', coalesce((select jsonb_agg(jsonb_build_object('key',key,'name',name) order by name) from public.sectors),'[]'::jsonb)),
    'collaborators', coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'employeeId',c.employee_id,'name',c.name,'role',c.role,
      'management',m.name,'sector',s.name,'admission',coalesce(c.admission::text,''),'status',c.status,
      'periods',coalesce((select jsonb_agg(jsonb_build_object(
        'cycle',p.cycle,'start',p.start_date,'end',p.end_date,'days',p.days,
        'status',p.status,'invalid',p.invalid,'conflicts','[]'::jsonb,'conflictLevel','none') order by p.cycle)
        from public.vacation_periods p where p.collaborator_id=c.id),'[]'::jsonb)
    ) order by m.name,c.name) from public.collaborators c
      join public.managers m on m.key=c.manager_key join public.sectors s on s.key=c.sector_key),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create function public.apply_mutation(mutation jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  current_revision bigint;
  action text := mutation->>'action';
  person jsonb := mutation->'collaborator';
  period jsonb := mutation->'period';
  record_id text;
  new_key text;
  old_key text;
  registry_name text;
begin
  if auth.uid() is null then raise exception 'Login obrigatório' using errcode='42501'; end if;
  select revision into current_revision from public.app_metadata where id for update;
  if mutation->>'expectedRevision' is null or (mutation->>'expectedRevision')::bigint <> current_revision then
    raise exception 'Outra pessoa atualizou os dados. Recarregue e tente novamente.' using errcode='40001';
  end if;
  if action='upsertCollaborator' then
    record_id := coalesce(nullif(mutation->>'originalId',''),nullif(person->>'id',''),gen_random_uuid()::text);
    if nullif(mutation->>'originalId','') is not null and not exists(select 1 from public.collaborators where id=record_id) then
      raise exception 'Colaborador não encontrado';
    end if;
    insert into public.collaborators(id,employee_id,name,role,manager_key,sector_key,admission,status)
    values(record_id,trim(person->>'employeeId'),trim(person->>'name'),trim(person->>'role'),
      public.registry_key(person->>'management','manager'),public.registry_key(person->>'sector'),
      nullif(person->>'admission','')::date,person->>'status')
    on conflict(id) do update set employee_id=excluded.employee_id,name=excluded.name,role=excluded.role,
      manager_key=excluded.manager_key,sector_key=excluded.sector_key,admission=excluded.admission,
      status=excluded.status,updated_at=now();
  elsif action='deleteCollaborator' then
    record_id := mutation->>'id';
    delete from public.collaborators where id=record_id;
    if not found then raise exception 'Colaborador não encontrado'; end if;
  elsif action='upsertVacation' then
    record_id := mutation->>'collaboratorId';
    if (period->>'end')::date < (period->>'start')::date then raise exception 'A data final deve ser igual ou posterior à inicial'; end if;
    insert into public.vacation_periods(collaborator_id,cycle,start_date,end_date,status)
    values(record_id,(period->>'cycle')::integer,(period->>'start')::date,(period->>'end')::date,period->>'status')
    on conflict(collaborator_id,cycle) do update set start_date=excluded.start_date,end_date=excluded.end_date,
      status=excluded.status,updated_at=now();
  elsif action='saveRegistry' then
    registry_name := trim(mutation->>'name');
    new_key := public.registry_key(registry_name,mutation->>'registryType');
    old_key := nullif(mutation->>'oldKey','');
    if coalesce(new_key,'')='' then raise exception 'Nome inválido'; end if;
    record_id := new_key;
    if mutation->>'registryType'='manager' then
      if old_key is not null then
        update public.managers set key=new_key,name=registry_name,updated_at=now() where key=old_key;
        if not found then raise exception 'Gestor não encontrado'; end if;
      else insert into public.managers(key,name) values(new_key,registry_name); end if;
    elsif mutation->>'registryType'='sector' then
      if old_key is not null then
        update public.sectors set key=new_key,name=registry_name,updated_at=now() where key=old_key;
        if not found then raise exception 'Setor não encontrado'; end if;
      else insert into public.sectors(key,name) values(new_key,registry_name); end if;
    else raise exception 'Cadastro inválido'; end if;
  elsif action='deleteRegistry' then
    record_id := mutation->>'key';
    if mutation->>'registryType'='manager' then delete from public.managers where key=record_id;
    elsif mutation->>'registryType'='sector' then delete from public.sectors where key=record_id;
    else raise exception 'Cadastro inválido'; end if;
    if not found then raise exception 'Cadastro não encontrado'; end if;
  else raise exception 'Alteração não reconhecida'; end if;
  insert into public.audit_log(actor_user_id,action,entity_id) values(auth.uid(),action,record_id);
  update public.app_metadata set revision=revision+1,updated_at=now() where id;
  return public.get_shared_state();
end;
$$;

-- No table access through the Data API. Only these two authenticated RPCs.
revoke all on function public.get_shared_state() from public,anon,authenticated;
revoke all on function public.apply_mutation(jsonb) from public,anon,authenticated;
grant usage on schema public to authenticated;
grant execute on function public.get_shared_state() to authenticated;
grant execute on function public.apply_mutation(jsonb) to authenticated;
commit;
