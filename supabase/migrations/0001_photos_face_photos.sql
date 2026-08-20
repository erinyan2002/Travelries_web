-- Personal photo data, migrating off localStorage (`map-<uid>` / `faces-<uid>`).
-- Column names match lib/types.ts's rowToMapPhoto / rowToFacePhoto exactly — don't
-- rename columns here without updating those converters too.
--
-- Run this whole file in the Supabase SQL editor (Database > SQL Editor > New query).

-- ── photos (MapPhoto) ─────────────────────────────────────────────────────────
create table if not exists public.photos (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  file_name          text not null,
  lat                double precision,
  lng                double precision,
  location           text,
  capture_date       text,             -- locale-formatted display string, not sortable
  capture_time       text,             -- locale-formatted display string, not sortable
  capture_timestamp  timestamptz,      -- real chronological key, use this for sorting/routes
  uploaded_at        timestamptz not null default now(),
  face_count         integer not null default 0,
  image_path         text,             -- path within the `user-photos` storage bucket
  created_at         timestamptz not null default now()
);

create index if not exists photos_user_id_idx on public.photos (user_id);
create index if not exists photos_user_id_capture_timestamp_idx on public.photos (user_id, capture_timestamp);

alter table public.photos enable row level security;

create policy "photos_select_own" on public.photos
  for select using (auth.uid() = user_id);
create policy "photos_insert_own" on public.photos
  for insert with check (auth.uid() = user_id);
create policy "photos_update_own" on public.photos
  for update using (auth.uid() = user_id);
create policy "photos_delete_own" on public.photos
  for delete using (auth.uid() = user_id);

-- ── face_photos (FacePhoto) ──────────────────────────────────────────────────
create table if not exists public.face_photos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  file_name     text not null,
  face_count    integer not null default 0,
  uploaded_at   timestamptz not null default now(),
  boxes         jsonb,   -- Array<{ x, y, width, height }>, normalized 0–1
  descriptors   jsonb,   -- number[][], one descriptor vector per detected face
  confidences   jsonb,   -- number[]
  ages          jsonb,   -- number[]
  genders       jsonb,   -- string[]
  expressions   jsonb,   -- string[]
  lat           double precision,
  lng           double precision,
  location      text,
  image_path    text,    -- path within the `user-photos` storage bucket
  created_at    timestamptz not null default now()
);

create index if not exists face_photos_user_id_idx on public.face_photos (user_id);

alter table public.face_photos enable row level security;

create policy "face_photos_select_own" on public.face_photos
  for select using (auth.uid() = user_id);
create policy "face_photos_insert_own" on public.face_photos
  for insert with check (auth.uid() = user_id);
create policy "face_photos_update_own" on public.face_photos
  for update using (auth.uid() = user_id);
create policy "face_photos_delete_own" on public.face_photos
  for delete using (auth.uid() = user_id);

-- ── Storage bucket ────────────────────────────────────────────────────────────
-- app/page.tsx already uploads to a `user-photos` bucket at path `<uid>/<photoId>.<ext>`
-- (see uploadToUserPhotos). If that bucket doesn't have RLS policies yet, add:
--
-- create policy "user_photos_select_own" on storage.objects
--   for select using (bucket_id = 'user-photos' and (storage.foldername(name))[1] = auth.uid()::text);
-- create policy "user_photos_insert_own" on storage.objects
--   for insert with check (bucket_id = 'user-photos' and (storage.foldername(name))[1] = auth.uid()::text);
-- create policy "user_photos_delete_own" on storage.objects
--   for delete using (bucket_id = 'user-photos' and (storage.foldername(name))[1] = auth.uid()::text);
