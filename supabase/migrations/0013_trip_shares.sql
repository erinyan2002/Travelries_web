-- Public share links for a whole trip (Albums > Trips view > Share), served at
-- /trip/[id] without login. Like `posts`, a row is a denormalized SNAPSHOT of
-- the trip taken at share time (photos as a jsonb array of image_url/location/
-- date/lat/lng), not live references into `photos` — so the public page never
-- needs anonymous SELECT access to anyone's `photos` rows, and later edits or
-- deletes of the source photos don't change what was shared.
-- Safe to re-run.
--
-- Run this whole file in the Supabase SQL editor (Database > SQL Editor > New query).

create table if not exists public.trip_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  date_range text,
  locations text[] not null default '{}',
  diary text,
  photos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.trip_shares enable row level security;

-- Anyone holding the (unguessable uuid) link can read it — same model as `shares`.
drop policy if exists "trip_shares_select_public" on public.trip_shares;
create policy "trip_shares_select_public"
  on public.trip_shares for select
  to anon, authenticated
  using (true);

drop policy if exists "trip_shares_insert_own" on public.trip_shares;
create policy "trip_shares_insert_own"
  on public.trip_shares for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "trip_shares_delete_own" on public.trip_shares;
create policy "trip_shares_delete_own"
  on public.trip_shares for delete
  to authenticated
  using (auth.uid() = user_id);

grant select on public.trip_shares to anon, authenticated;
grant insert, delete on public.trip_shares to authenticated;
