import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222',camera='33333333-3333-4333-8333-333333333333';
test('Supabase policies isolate accounts and private broadcast, deny anonymous/disabled access',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema realtime;
   create table auth.users(id uuid primary key);grant usage on schema auth,realtime to anon,authenticated;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
   create table realtime.messages(id bigserial primary key,extension text);
   grant usage,select on sequence realtime.messages_id_seq to authenticated;
   insert into auth.users values('${alice}'),('${bob}');`);
  const migration=await fs.readFile(new URL('../supabase/migrations/202610310001_remote.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);
  await db.exec(`insert into public.remote_memberships values('${alice}',true),('${bob}',true);set role authenticated;set request.jwt.claim.sub='${alice}';`);
  await db.exec(`insert into public.remote_cameras(id,owner_id,name) values('${camera}','${alice}','Entrada');`);
  assert.equal((await db.query('select * from public.remote_cameras')).rows.length,1);
  await assert.rejects(()=>db.exec(`insert into public.remote_memberships values('${alice}',true);`));
  await db.exec(`set request.jwt.claim.sub='${bob}';`);assert.equal((await db.query('select * from public.remote_cameras')).rows.length,0);
  await assert.rejects(()=>db.exec(`insert into public.remote_cameras(id,owner_id,name) values('44444444-4444-4444-8444-444444444444','${alice}','Forbidden');`));
  await db.exec(`set realtime.topic='security-cam:${alice}:${camera}';`);await assert.rejects(()=>db.exec("insert into realtime.messages(extension) values('broadcast')"));
  await db.exec(`set request.jwt.claim.sub='${alice}';`);await db.exec("insert into realtime.messages(extension) values('broadcast')");assert.equal((await db.query('select * from realtime.messages')).rows.length,1);
  await db.exec(`set request.jwt.claim.sub='${bob}';`);assert.equal((await db.query('select * from realtime.messages')).rows.length,0);
  await db.exec(`reset role;update public.remote_memberships set enabled=false where user_id='${alice}';set role authenticated;set request.jwt.claim.sub='${alice}';`);
  assert.equal((await db.query('select * from public.remote_cameras')).rows.length,0);await assert.rejects(()=>db.exec("insert into realtime.messages(extension) values('broadcast')"));
  await db.exec('set role anon;');await assert.rejects(()=>db.query('select * from public.remote_cameras'));
 }finally{await db.close()}
});
