-- Lets a user manually mark two auto-clustered faces as "the same person" (fixes
-- cases where lighting/angle push the same real person's descriptor distance past
-- MATCH_THRESHOLD in clusterByPerson(), app/faces/page.tsx, so they show as separate
-- Person cards), and lets the upload flow tag a newly-detected face as an existing
-- person directly instead of relying only on automatic clustering. A manual
-- assignment always wins over the distance-based algorithm.
-- Safe to re-run — every ADD COLUMN / CREATE TABLE is IF NOT EXISTS, and every
-- policy is dropped and recreated (CREATE POLICY has no IF NOT EXISTS clause).
--
-- Run this whole file in the Supabase SQL editor (Database > SQL Editor > New query).
-- Double-check the `user_id` column type/reference below matches the live `photos`
-- table before running (see CLAUDE.md note on verifying schema before migrating).

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.people enable row level security;

drop policy if exists "people_select_own" on public.people;
create policy "people_select_own"
  on public.people for select
  using (auth.uid() = user_id);

drop policy if exists "people_insert_own" on public.people;
create policy "people_insert_own"
  on public.people for insert
  with check (auth.uid() = user_id);

drop policy if exists "people_update_own" on public.people;
create policy "people_update_own"
  on public.people for update
  using (auth.uid() = user_id);

drop policy if exists "people_delete_own" on public.people;
create policy "people_delete_own"
  on public.people for delete
  using (auth.uid() = user_id);

-- One entry per detected face, index-aligned with photos.boxes/descriptors — null
-- (or array not present) until a face is manually tagged at upload time or merged
-- into a person from the Faces page. Faces with no entry here keep going through
-- the existing distance-based clustering in clusterByPerson().
alter table public.photos
  add column if not exists person_ids jsonb;
