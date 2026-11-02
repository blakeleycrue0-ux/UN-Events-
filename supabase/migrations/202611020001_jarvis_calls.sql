-- Jarvis on the phone: reminders, the user's profile for calls, and call state.
-- Only the edge functions (service role) touch these tables: RLS on, no policies.
create table if not exists public.jarvis_state (
  id int primary key check (id = 1),
  name text not null default 'Crew',
  lang text not null default 'en' check (lang in ('en', 'es')),
  hear text not null default 'es-ES' check (hear in ('es-ES', 'en-US')),
  memory jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.jarvis_reminders (
  id uuid primary key default gen_random_uuid(),
  due_at timestamptz not null,
  text text not null check (char_length(text) between 1 and 400),
  via text not null default 'chromebook' check (via in ('call', 'chromebook', 'email')),
  lang text not null default 'en' check (lang in ('en', 'es')),
  done boolean not null default false,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists jarvis_reminders_due on public.jarvis_reminders (due_at) where not done;
create table if not exists public.jarvis_calls (
  sid text primary key,
  turns jsonb not null default '[]'::jsonb,
  misses int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.jarvis_state enable row level security;
alter table public.jarvis_reminders enable row level security;
alter table public.jarvis_calls enable row level security;
revoke all on public.jarvis_state, public.jarvis_reminders, public.jarvis_calls from anon, authenticated;

-- Every minute: if a reminder is due, wake jarvis-call. The shared secret lives
-- in Vault as 'jarvis_cron'; jarvis-call checks it with jarvis_cron_check().
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'jarvis-reminders';
select cron.schedule('jarvis-reminders', '* * * * *', $$
  select net.http_post(
    url := 'https://pmzekgfgwlfugfffzhrt.supabase.co/functions/v1/jarvis-call?step=cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jarvis-cron',
      (select decrypted_secret from vault.decrypted_secrets where name = 'jarvis_cron' limit 1)),
    body := '{}'::jsonb)
  where exists (select 1 from public.jarvis_reminders where not done and due_at <= now())
    and exists (select 1 from vault.decrypted_secrets where name = 'jarvis_cron');
$$);
-- Old finished calls and reminders are cleaned up daily.
select cron.unschedule(jobid) from cron.job where jobname = 'jarvis-cleanup';
select cron.schedule('jarvis-cleanup', '17 4 * * *', $$
  delete from public.jarvis_calls where created_at < now() - interval '2 days';
  delete from public.jarvis_reminders where done and delivered_at < now() - interval '30 days';
$$);

create or replace function public.jarvis_cron_check(token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'jarvis_cron' and length(token) >= 16 and decrypted_secret = token)
$$;
revoke execute on function public.jarvis_cron_check(text) from public, anon, authenticated;
grant execute on function public.jarvis_cron_check(text) to service_role;

-- The guard-mode code (4 digits) is stored privately here, not in the public site.
alter table public.jarvis_state add column if not exists guard_pin text check (guard_pin ~ '^[0-9]{4}$');

-- Web Push to the phone remote. The VAPID signing key (P-256 JWK) is a Vault
-- secret named 'jarvis_vapid'; only the service role can read it.
create or replace function public.jarvis_vapid() returns jsonb
language sql stable security definer set search_path = '' as $$
  select decrypted_secret::jsonb from vault.decrypted_secrets where name = 'jarvis_vapid' limit 1
$$;
revoke execute on function public.jarvis_vapid() from public, anon, authenticated;
grant execute on function public.jarvis_vapid() to service_role;
create table if not exists public.jarvis_push (
  endpoint text primary key check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.jarvis_push enable row level security;
revoke all on public.jarvis_push from anon, authenticated;
