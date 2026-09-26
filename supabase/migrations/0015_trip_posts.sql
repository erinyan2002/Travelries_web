-- Trip posts: a feed post can share a whole trip ("Sokcho Trip · 2 days,
-- 4 places, 8 photos") instead of one photo. `trip` holds a small summary for
-- the feed card plus the id of the public trip_shares snapshot it links to.
-- Visibility is unchanged — the existing "own or followed" posts RLS applies.
alter table public.posts add column if not exists trip jsonb;
