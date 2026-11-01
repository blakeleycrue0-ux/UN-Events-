import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('single-use invitations isolate installations, leases and private signal channels',async()=>{
 const db=new PGlite();
 const viewer='11111111-1111-4111-8111-111111111111',host='22222222-2222-4222-8222-222222222222',stranger='33333333-3333-4333-8333-333333333333';
 const lease='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const hash='a'.repeat(64);
 const as=async uid=>db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${uid}';`);
 try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema realtime;
   create table auth.users(id uuid primary key);grant usage on schema auth,realtime to anon,authenticated;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
   create table realtime.messages(extension text);
   alter table realtime.messages enable row level security;
   grant select,insert on realtime.messages to authenticated;
   insert into auth.users values('${viewer}'),('${host}'),('${stranger}');`);
  const migration=await fs.readFile(new URL('../supabase/migrations/202611010001_pairing.sql',import.meta.url),'utf8');
  // Supabase's managed messages table permits policy changes, not owner-only DDL.
  assert.doesNotMatch(migration,/alter\s+table\s+(?:"?realtime"?\.)?"?messages"?/i);
  await db.exec('alter table realtime.messages disable row level security');
  await assert.rejects(()=>db.exec(migration),/must already have RLS enabled/);
  await db.exec('rollback;alter table realtime.messages enable row level security');
  assert.equal((await db.query("select to_regclass('public.camera_links') missing")).rows[0].missing,null);
  await db.exec(migration);await db.exec(migration);
  await db.exec('set role anon');await assert.rejects(()=>db.query(`select public.pair_camera_create('${hash}','Entrada')`));
  await assert.rejects(()=>db.query('select id from public.camera_links'));
  await as(viewer);
  const id=(await db.query(`select public.pair_camera_create('${hash}','Entrada') id`)).rows[0].id;
  assert.equal((await db.query('select id from public.camera_links')).rows.length,1);
  await assert.rejects(()=>db.query('select invite_hash from public.camera_links'));
  await assert.rejects(()=>db.exec(`update public.camera_links set camera_id='${viewer}'`));
  await assert.rejects(()=>db.query(`select public.pair_camera_claim('${hash}')`));
  await as(stranger);assert.equal((await db.query('select id from public.camera_links')).rows.length,0);
  await assert.rejects(()=>db.query(`select public.pair_camera_claim('${'b'.repeat(64)}')`));
  await as(host);assert.equal((await db.query(`select public.pair_camera_claim('${hash}') id`)).rows[0].id,id);
  assert.equal((await db.query('select id from public.camera_links')).rows.length,1);
  await as(stranger);await assert.rejects(()=>db.query(`select public.pair_camera_claim('${hash}')`));
  assert.equal((await db.query(`select public.pair_camera_publish('${id}','${lease}',true) ok`)).rows[0].ok,false);
  await as(viewer);assert.equal((await db.query(`select public.pair_camera_publish('${id}','${lease}',true) ok`)).rows[0].ok,false);
  await as(host);assert.equal((await db.query(`select public.pair_camera_publish('${id}','${lease}',true) ok`)).rows[0].ok,true);
  assert.equal((await db.query(`select public.pair_camera_publish('${id}','${other}',true) ok`)).rows[0].ok,false);
  assert.equal((await db.query(`select public.pair_camera_publish('${id}','${other}',false) ok`)).rows[0].ok,false);
  const topic=`security-pair:${id}:${lease}`;
  for(const uid of [host,viewer]){
   await as(uid);await db.exec(`set realtime.topic='${topic}'`);
   assert.equal((await db.query(`select public.pair_camera_channel_allowed('${topic}') ok`)).rows[0].ok,true);
   await db.exec(`insert into realtime.messages values('broadcast')`);
   await db.exec(`set realtime.topic='security-pair:${id}:${other}'`);
   await assert.rejects(()=>db.exec(`insert into realtime.messages values('broadcast')`));
  }
  await as(stranger);await db.exec(`set realtime.topic='${topic}'`);
  await assert.rejects(()=>db.exec(`insert into realtime.messages values('broadcast')`));
  assert.equal((await db.query('select * from realtime.messages')).rows.length,0);
  assert.equal((await db.query(`select public.pair_camera_revoke('${id}') ok`)).rows[0].ok,false);
  await db.exec(`reset role;update public.camera_links set last_seen=now()-interval '1 minute' where id='${id}'`);
  await as(host);assert.equal((await db.query(`select public.pair_camera_channel_allowed('${topic}') ok`)).rows[0].ok,false);
  assert.equal((await db.query(`select public.pair_camera_publish('${id}','${other}',true) ok`)).rows[0].ok,true);
  assert.equal((await db.query(`select public.pair_camera_publish('${id}','${lease}',false) ok`)).rows[0].ok,false);
  assert.equal((await db.query(`select public.pair_camera_channel_allowed('security-pair:${id}:${other}') ok`)).rows[0].ok,true);
  await as(viewer);assert.equal((await db.query(`select public.pair_camera_revoke('${id}') ok`)).rows[0].ok,true);
  await as(host);assert.equal((await db.query(`select public.pair_camera_channel_allowed('${topic}') ok`)).rows[0].ok,false);
  assert.equal((await db.query(`select public.pair_camera_publish('${id}','${lease}',true) ok`)).rows[0].ok,false);
  await assert.rejects(()=>db.exec(`insert into realtime.messages values('broadcast')`));
  await as(viewer);await db.query(`select public.pair_camera_create('${'c'.repeat(64)}','Caducada')`);
  await db.exec(`reset role;update public.camera_links set invite_expires=now()-interval '1 minute' where name='Caducada'`);
  await as(host);await assert.rejects(()=>db.query(`select public.pair_camera_claim('${'c'.repeat(64)}')`));
  await as(viewer);
  for(let i=1;i<=12;i++)await db.query(`select public.pair_camera_create('${i.toString(16).padStart(64,'0')}','Cámara')`);
  await assert.rejects(()=>db.query(`select public.pair_camera_create('${'f'.repeat(64)}','Exceso')`));
 } finally {await db.close()}
});
