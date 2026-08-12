-- Forge 12 cloud synchronization setup
-- Safe to run more than once.

create table if not exists public.training_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.training_state
  add column if not exists app_state jsonb not null default '{}'::jsonb,
  add column if not exists revision bigint not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table public.training_state enable row level security;

revoke all on public.training_state from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.training_state to authenticated;

drop policy if exists "Users manage their own training data" on public.training_state;

create policy "Users manage their own training data"
on public.training_state
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.set_training_state_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists training_state_set_updated_at on public.training_state;

create trigger training_state_set_updated_at
before update on public.training_state
for each row execute function public.set_training_state_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'training_state'
  ) then
    alter publication supabase_realtime add table public.training_state;
  end if;
end;
$$;

