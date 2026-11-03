-- Jarvis v2: watches email, Teams and Instagram, keeps a live feed and can call.
-- Only the edge functions (service role) touch these tables: RLS on, no policies.
create table if not exists public.jarvis_feed (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null check (source in ('gmail', 'school', 'teams', 'instagram', 'door', 'jarvis')),
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 600),
  say text not null default '' check (char_length(say) <= 400),
  level text not null default 'info' check (level in ('info', 'notify', 'call')),
  url text not null default '' check (url = '' or url ~ '^https://'),
  called boolean not null default false
);
create index if not exists jarvis_feed_recent on public.jarvis_feed (created_at desc);
-- Per source: what was seen last (snapshot text and item ids), to spot what's new.
create table if not exists public.jarvis_watch (
  source text primary key check (source in ('gmail', 'school', 'teams', 'instagram')),
  hash text not null default '',
  snapshot text not null default '',
  seen jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.jarvis_feed enable row level security;
alter table public.jarvis_watch enable row level security;
revoke all on public.jarvis_feed, public.jarvis_watch from anon, authenticated;
-- What to watch and how often Jarvis may call (set from the desk settings).
alter table public.jarvis_state add column if not exists watch jsonb not null default '{}'::jsonb;
-- Feed is kept 30 days.
select cron.unschedule(jobid) from cron.job where jobname = 'jarvis-feed-cleanup';
select cron.schedule('jarvis-feed-cleanup', '23 4 * * *', $$ delete from public.jarvis_feed where created_at < now() - interval '30 days'; $$);
