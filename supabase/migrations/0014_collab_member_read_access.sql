-- Lets every member of a collab album actually read it. Joining via
-- join_collab_album succeeded (a collab_members row was added), but the album
-- page then showed "Album not found": the new member had no SELECT access to
-- collab_albums (and so nothing else in the album either).
--
-- Additive only: Postgres OR's permissive policies together, so these can only
-- widen read access to members — nothing that works today changes. The RPC
-- itself (and whatever notifications it sends) is left untouched.
--
-- Membership checks go through SECURITY DEFINER helpers: a collab_members
-- policy that queried collab_members directly would recurse infinitely.
-- Safe to re-run.
--
-- Run this whole file in the Supabase SQL editor (Database > SQL Editor > New query).

create or replace function public.collab_is_member(p_album_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.collab_members m where m.album_id = p_album_id and m.user_id = auth.uid())
      or exists (select 1 from public.collab_albums a where a.id = p_album_id and a.owner_id = auth.uid());
$$;

create or replace function public.collab_can_see_photo(p_photo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.collab_photos p where p.id = p_photo_id and public.collab_is_member(p.album_id));
$$;

grant execute on function public.collab_is_member(uuid) to authenticated;
grant execute on function public.collab_can_see_photo(uuid) to authenticated;

drop policy if exists "collab_albums_select_members" on public.collab_albums;
create policy "collab_albums_select_members"
  on public.collab_albums for select to authenticated
  using (public.collab_is_member(id));

drop policy if exists "collab_members_select_members" on public.collab_members;
create policy "collab_members_select_members"
  on public.collab_members for select to authenticated
  using (public.collab_is_member(album_id));

drop policy if exists "collab_photos_select_members" on public.collab_photos;
create policy "collab_photos_select_members"
  on public.collab_photos for select to authenticated
  using (public.collab_is_member(album_id));

drop policy if exists "collab_reactions_select_members" on public.collab_reactions;
create policy "collab_reactions_select_members"
  on public.collab_reactions for select to authenticated
  using (public.collab_can_see_photo(photo_id));

drop policy if exists "collab_comments_select_members" on public.collab_comments;
create policy "collab_comments_select_members"
  on public.collab_comments for select to authenticated
  using (public.collab_can_see_photo(photo_id));
