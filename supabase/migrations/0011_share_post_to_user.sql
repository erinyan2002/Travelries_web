-- Lets a user send a post directly to someone they follow (or who follows
-- them) inside the app — an Instagram-"Send"-style alternative to the
-- public-link share in lib/shareUtils.ts. Delivered as a notification
-- (type `post_shared`) rather than a new inbox/DM table, since that's all
-- this needs: NotificationBell already renders a from-user + a link to the
-- post for every other social notification type.
--
-- Run this whole file in the Supabase SQL editor (Database > SQL Editor > New query).

-- Same SECURITY DEFINER pattern as tag_user_in_post (0007) / the engagement
-- triggers (0008): `notifications` RLS only allows inserting your own rows,
-- so writing a notification for the recipient has to go through a function
-- the caller doesn't control the body of.
create or replace function public.share_post_to_user(p_post_id uuid, p_to_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_to_user_id = auth.uid() then
    raise exception 'cannot share a post with yourself';
  end if;

  -- Same visibility rule as the feed itself (see post_tags_select_if_post_visible,
  -- 0007): you can only share a post you're actually allowed to see — your own,
  -- or one from someone you follow.
  if not exists (
    select 1 from public.posts p
    where p.id = p_post_id
      and (p.user_id = auth.uid() or exists (
        select 1 from public.follows f
        where f.follower_id = auth.uid() and f.following_id = p.user_id
      ))
  ) then
    raise exception 'post not found or not visible to you';
  end if;

  insert into public.notifications (user_id, type, message, data)
  values (
    p_to_user_id,
    'post_shared',
    'shared a post with you',
    jsonb_build_object('post_id', p_post_id, 'from_user_id', auth.uid())
  );
end;
$$;

grant execute on function public.share_post_to_user(uuid, uuid) to authenticated;
