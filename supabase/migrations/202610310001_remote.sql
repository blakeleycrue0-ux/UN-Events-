begin;
-- Apply in the Supabase SQL Editor as the project administrator.
create table if not exists public.remote_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false
);
create table if not exists public.remote_cameras (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  is_sharing boolean not null default false,
  last_seen timestamptz not null default now()
);
alter table public.remote_cameras add column if not exists session_id uuid;
create or replace function public.security_cam_stamp_camera()
returns trigger language plpgsql set search_path = '' as $$ begin new.last_seen = now(); return new; end $$;
drop trigger if exists stamp_security_camera on public.remote_cameras;
create trigger stamp_security_camera before insert or update on public.remote_cameras for each row execute function public.security_cam_stamp_camera();
alter table public.remote_memberships enable row level security;
alter table public.remote_cameras enable row level security;
revoke all on public.remote_memberships, public.remote_cameras from anon;
revoke all on public.remote_memberships, public.remote_cameras from authenticated;
grant select on public.remote_memberships to authenticated;
grant select, insert, update, delete on public.remote_cameras to authenticated;
create or replace function public.security_cam_remote_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.remote_memberships m where m.user_id = auth.uid() and m.enabled)
$$;
revoke all on function public.security_cam_remote_enabled() from public, anon;
grant execute on function public.security_cam_remote_enabled() to authenticated;
drop policy if exists "own remote membership" on public.remote_memberships;
create policy "own remote membership" on public.remote_memberships for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own cameras" on public.remote_cameras;
create policy "own cameras" on public.remote_cameras for all to authenticated
using (owner_id = (select auth.uid()) and (select public.security_cam_remote_enabled()))
with check (owner_id = (select auth.uid()) and (select public.security_cam_remote_enabled()));
do $$ begin
 if exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname not in ('security cam private read','security cam private write')) then
  raise exception 'Review existing realtime.messages policies before installing SECURITY CAM';
 end if;
end $$;
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated;
-- Realtime Broadcast uses private channels; anonymous or other-account access is denied.
drop policy if exists "security cam private read" on realtime.messages;
create policy "security cam private read" on realtime.messages for select to authenticated
using (extension = 'broadcast' and (select public.security_cam_remote_enabled())
 and split_part((select realtime.topic()), ':', 1) = 'security-cam'
 and split_part((select realtime.topic()), ':', 2) = (select auth.uid())::text
 and exists (select 1 from public.remote_cameras c where c.id::text = split_part((select realtime.topic()), ':', 3) and c.owner_id = (select auth.uid())));
drop policy if exists "security cam private write" on realtime.messages;
create policy "security cam private write" on realtime.messages for insert to authenticated
with check (extension = 'broadcast' and (select public.security_cam_remote_enabled())
 and split_part((select realtime.topic()), ':', 1) = 'security-cam'
 and split_part((select realtime.topic()), ':', 2) = (select auth.uid())::text
 and exists (select 1 from public.remote_cameras c where c.id::text = split_part((select realtime.topic()), ':', 3) and c.owner_id = (select auth.uid())));

commit;
