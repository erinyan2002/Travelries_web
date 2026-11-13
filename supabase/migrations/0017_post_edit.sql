-- Lets an author edit their own post's caption (posts had select/insert/delete
-- policies only, so an update silently matched zero rows).
--
-- Run this whole file in the Supabase SQL editor (Database > SQL Editor > New query).

drop policy if exists "posts_update_own" on public.posts;
create policy "posts_update_own"
  on public.posts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
