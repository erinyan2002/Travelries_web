-- Lets a Faces-page person (public.people, 0010) be linked to a real app account,
-- so posting a photo with that person's face can suggest tagging them
-- (app/feed/page.tsx NewPostModal). The link is private to the people row's
-- owner — the linked user isn't notified and can't see it; existing
-- people_* RLS policies (owner-only) already cover the new column.
-- Safe to re-run.
--
-- Run this whole file in the Supabase SQL editor (Database > SQL Editor > New query).

alter table public.people
  add column if not exists linked_user_id uuid references auth.users(id) on delete set null;
