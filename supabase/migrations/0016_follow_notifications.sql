-- Notifies a user when someone starts following them (type `new_follower`), the
-- same way likes and comments notify (0008_engagement_notifications.sql): an AFTER
-- INSERT trigger on `follows`, SECURITY DEFINER because `notifications` RLS only
-- lets you insert your own rows and this one is for the person being followed.
--
-- Unfollowing and following again within a day doesn't stack up more
-- notifications from the same person.
--
-- Run this whole file in the Supabase SQL editor (Database > SQL Editor > New query).

create or replace function public.notify_new_follower()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.follower_id <> new.following_id and not exists (
    select 1 from public.notifications
    where user_id = new.following_id
      and type = 'new_follower'
      and data->>'from_user_id' = new.follower_id::text
      and created_at > now() - interval '1 day'
  ) then
    insert into public.notifications (user_id, type, message, data)
    values (
      new.following_id,
      'new_follower',
      'Someone started following you',
      jsonb_build_object('from_user_id', new.follower_id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_follow_notify on public.follows;
create trigger on_follow_notify
  after insert on public.follows
  for each row execute function public.notify_new_follower();
