-- Weekly Shop: database schema and security rules.
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
--
-- Model: one household holds everything. People are members of the household:
--   owner  - you; can manage invites
--   member - your wife; full use of the app
--   agent  - the PC agent; can read everything but only update runs, prices and requests
-- All data lives in one "docs" table of JSON documents addressed by path
-- (e.g. 'runs/2026-10-19', 'catalog/master'), mirroring the Claude version of the app.

create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member','agent')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_invites (
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('owner','member','agent')),
  created_at timestamptz not null default now(),
  primary key (household_id, email)
);

create table if not exists public.docs (
  household_id uuid not null references public.households(id) on delete cascade,
  path text not null check (path ~ '^[A-Za-z0-9_.~:@+-]+(/[A-Za-z0-9_.~:@+-]+)+$'),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (household_id, path)
);
create index if not exists docs_household_idx on public.docs(household_id);

-- Realtime needs the old row on delete so other phones can drop it.
alter table public.docs replica identity full;

-- ---------- helpers (security definer so policies can use them without recursion) ----------
create or replace function public.my_role(hh uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.household_members where household_id = hh and user_id = auth.uid()
$$;

create or replace function public.is_member(hh uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members where household_id = hh and user_id = auth.uid())
$$;

-- Called by the app right after sign-in: turns any invite for this email into a membership.
create or replace function public.claim_invites() returns setof uuid
language plpgsql security definer set search_path = public as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or me = '' then return; end if;
  insert into public.household_members(household_id, user_id, role)
    select household_id, auth.uid(), role from public.household_invites where lower(email) = me
    on conflict (household_id, user_id) do nothing;
  delete from public.household_invites where lower(email) = me;
  return query select household_id from public.household_members where user_id = auth.uid();
end $$;
revoke all on function public.claim_invites() from public, anon;
grant execute on function public.claim_invites() to authenticated;

-- Keep updated_at / updated_by honest.
create or replace function public.docs_touch() returns trigger
language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
  for each row execute function public.docs_touch();

-- ---------- row-level security ----------
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.docs enable row level security;

drop policy if exists hh_read on public.households;
create policy hh_read on public.households for select to authenticated using (public.is_member(id));

drop policy if exists members_read on public.household_members;
create policy members_read on public.household_members for select to authenticated using (public.is_member(household_id));

drop policy if exists invites_owner on public.household_invites;
create policy invites_owner on public.household_invites for all to authenticated
  using (public.my_role(household_id) = 'owner') with check (public.my_role(household_id) = 'owner');

drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select to authenticated using (public.is_member(household_id));

-- People (owner, member) can write anything in their household.
drop policy if exists docs_people_insert on public.docs;
create policy docs_people_insert on public.docs for insert to authenticated
  with check (public.my_role(household_id) in ('owner','member'));
drop policy if exists docs_people_update on public.docs;
create policy docs_people_update on public.docs for update to authenticated
  using (public.my_role(household_id) in ('owner','member')) with check (public.my_role(household_id) in ('owner','member'));
drop policy if exists docs_people_delete on public.docs;
create policy docs_people_delete on public.docs for delete to authenticated
  using (public.my_role(household_id) in ('owner','member'));

-- The PC agent may only update existing runs, prices, catalogues, recipes it resolves and requests. No deletes.
drop policy if exists docs_agent_update on public.docs;
create policy docs_agent_update on public.docs for update to authenticated
  using (public.my_role(household_id) = 'agent' and (path like 'runs/%' or path in ('catalog/master','catalog/ready') or path like 'catalogue/%' or path like 'requests/%' or path like 'recipes/%' or path like 'items/%'))
  with check (public.my_role(household_id) = 'agent' and (path like 'runs/%' or path in ('catalog/master','catalog/ready') or path like 'catalogue/%' or path like 'requests/%' or path like 'recipes/%' or path like 'items/%'));

grant select, insert, update, delete on public.docs to authenticated;
grant select on public.households, public.household_members to authenticated;
grant select, insert, delete on public.household_invites to authenticated;

-- Live updates between your phones.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
