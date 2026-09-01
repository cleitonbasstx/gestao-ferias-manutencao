import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Shared database: authentication, mutations, conflicts and referential integrity', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;`);
    await db.exec(await readFile('supabase/migrations/202608310001_initial.sql','utf8'));
    await assert.rejects(db.query('select public.get_shared_state()'), /Login obrigatório/);
    await db.exec('set role anon');
    await assert.rejects(db.query('select public.get_shared_state()'), /permission denied/);
    await assert.rejects(db.query('select * from public.collaborators'), /permission denied/);
    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);`);
    await assert.rejects(db.query('select * from public.collaborators'), /permission denied/);
    const state = async () => (await db.query('select public.get_shared_state() as data')).rows[0].data;
    let current = await state();
    assert.equal(current.revision,0);
    assert.deepEqual(current.collaborators,[]);
    const mutate = async data => {
      const result = await db.query('select public.apply_mutation($1::jsonb) as data',[JSON.stringify({expectedRevision:current.revision,...data})]);
      current = result.rows[0].data;
      return current;
    };
    await mutate({action:'saveRegistry',registryType:'manager',name:'Gestão Exemplo'});
    assert.equal(current.revision,1);
    assert.equal(current.registries.managers[0].key,'exemplo');
    await mutate({action:'saveRegistry',registryType:'sector',name:'Setor Exemplo'});
    const person={id:'test-1',employeeId:'TEST-001',name:'Pessoa de Teste',role:'Técnico(a)',management:'Gestão Exemplo',sector:'Setor Exemplo',status:'Ativo',admission:''};
    await mutate({action:'upsertCollaborator',collaborator:person});
    assert.equal(current.collaborators.length,1);
    await mutate({action:'upsertVacation',collaboratorId:'test-1',period:{cycle:1,start:'2026-09-01',end:'2026-09-10',status:'Planejada'}});
    assert.equal(current.collaborators[0].periods[0].days,10);
    await assert.rejects(mutate({action:'upsertVacation',collaboratorId:'test-1',period:{cycle:1,start:'2026-09-10',end:'2026-09-01',status:'Planejada'}}),/data final/);
    await assert.rejects(mutate({action:'deleteCollaborator',id:'test-1',expectedRevision:0}),/Outra pessoa/);
    await assert.rejects(mutate({action:'deleteRegistry',registryType:'sector',key:'setor exemplo'}),/foreign key/);
    await mutate({action:'saveRegistry',registryType:'sector',oldKey:'setor exemplo',name:'Setor Renomeado'});
    assert.equal(current.collaborators[0].sector,'Setor Renomeado');
    await mutate({action:'upsertCollaborator',originalId:'test-1',collaborator:{...person,sector:'Setor Renomeado',role:'Mecânico(a)'}});
    assert.equal(current.collaborators[0].periods.length,1);
    await mutate({action:'deleteCollaborator',id:'test-1'});
    assert.equal(current.collaborators.length,0);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as n from public.vacation_periods')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int as n from public.audit_log')).rows[0].n,current.revision);
  } finally { await db.close(); }
});
