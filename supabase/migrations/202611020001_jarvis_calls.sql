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
-- in Vault as 'jarvis_cron' (same value as the JARVIS_CRON_SECRET function secret).
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
