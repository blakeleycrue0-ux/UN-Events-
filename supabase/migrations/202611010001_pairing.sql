begin;
-- Independent of the retired email/password camera registry. Apply as administrator.
create table if not exists public.camera_links (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references auth.users(id) on delete cascade,
  camera_id uuid references auth.users(id) on delete cascade,
  name text not null check(char_length(name) between 1 and 60),
  invite_hash text unique,
  invite_expires timestamptz not null default (now() + interval '10 minutes'),
  revoked boolean not null default false,
  lease uuid,
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  check (camera_id is null or camera_id <> viewer_id),
  check (invite_hash is null or invite_hash ~ '^[a-f0-9]{64}$')
);
alter table public.camera_links enable row level security;
revoke all on public.camera_links from anon, authenticated;
-- Never disclose even the invitation hash through the REST table endpoint.
grant select(id,viewer_id,camera_id,name,invite_expires,revoked,lease,last_seen,created_at)
  on public.camera_links to authenticated;
drop policy if exists "paired devices read" on public.camera_links;
create policy "paired devices read" on public.camera_links for select to authenticated
  using(viewer_id=(select auth.uid()) or camera_id=(select auth.uid()));

create or replace function public.pair_camera_create(token_hash text, camera_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if token_hash !~ '^[a-f0-9]{64}$' or token_hash is null then raise exception 'Invalid invitation'; end if;
  -- Serialize quota checks for this installation, including concurrent tabs.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if (select count(*) from public.camera_links where viewer_id=auth.uid() and not revoked
      and (camera_id is not null or invite_expires>now())) >= 12 then
    raise exception 'Too many cameras or pending invitations';
  end if;
  insert into public.camera_links(viewer_id,name,invite_hash)
    values(auth.uid(),left(trim(camera_name),60),token_hash) returning id into result;
  return result;
end $$;

create or replace function public.pair_camera_claim(token_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare linked public.camera_links;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into linked from public.camera_links where invite_hash=token_hash
    and not revoked and camera_id is null and invite_expires>now() for update;
  if linked.id is null or linked.viewer_id=auth.uid() then
    raise exception 'Invitation expired, used, invalid or opened on its originating device';
  end if;
  update public.camera_links set camera_id=auth.uid(),invite_hash=null where id=linked.id;
  return linked.id;
end $$;

create or replace function public.pair_camera_publish(link_id uuid, session_id uuid, sharing boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or session_id is null then raise exception 'Authentication required'; end if;
  -- A second tab cannot steal a fresh publisher's lease. Stale leases can recover.
  update public.camera_links set lease=case when sharing then session_id else null end,
    last_seen=case when sharing then clock_timestamp() else null end
    where id=link_id and camera_id=auth.uid() and not revoked
    and (lease is null or lease=session_id or last_seen<now()-interval '45 seconds');
  return found;
end $$;

create or replace function public.pair_camera_revoke(link_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.camera_links set revoked=true,invite_hash=null,lease=null,last_seen=null
    where id=link_id and (viewer_id=auth.uid() or camera_id=auth.uid()) and not revoked;
  return found;
end $$;

create or replace function public.pair_camera_channel_allowed(topic text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.camera_links c where not c.revoked
   and c.camera_id is not null and (c.viewer_id=auth.uid() or c.camera_id=auth.uid())
   and c.lease is not null and c.last_seen>now()-interval '45 seconds'
   and topic='security-pair:'||c.id::text||':'||c.lease::text)
$$;

revoke all on function public.pair_camera_create(text,text),public.pair_camera_claim(text),
 public.pair_camera_publish(uuid,uuid,boolean),public.pair_camera_revoke(uuid),
 public.pair_camera_channel_allowed(text) from public,anon;
grant execute on function public.pair_camera_create(text,text),public.pair_camera_claim(text),
 public.pair_camera_publish(uuid,uuid,boolean),public.pair_camera_revoke(uuid),
 public.pair_camera_channel_allowed(text) to authenticated;

-- Abort rather than combine with unknown permissive broadcast policies.
do $$ begin
 if exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages'
 and policyname not in ('security cam private read','security cam private write','paired cameras read','paired cameras write')) then
   raise exception 'Review existing realtime.messages policies before installing paired cameras';
 end if;
end $$;
alter table realtime.messages enable row level security;
grant usage on schema realtime to authenticated;
grant select,insert on realtime.messages to authenticated;
drop policy if exists "paired cameras read" on realtime.messages;
create policy "paired cameras read" on realtime.messages for select to authenticated
 using(extension='broadcast' and public.pair_camera_channel_allowed((select realtime.topic())));
drop policy if exists "paired cameras write" on realtime.messages;
create policy "paired cameras write" on realtime.messages for insert to authenticated
 with check(extension='broadcast' and public.pair_camera_channel_allowed((select realtime.topic())));
commit;
