import { supabase } from "./supabase";
import { RealtimeChannel } from "@supabase/supabase-js";

export type AppNotification = {
  id: string;
  user_id: string;
  type: string;
  message: string;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
};

export async function getNotifications(limit = 30): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as AppNotification[];
}

export async function markAllRead(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", user.id)
    .eq("read", false);
}

export async function recordShareView(shareId: string): Promise<void> {
  await supabase.rpc("record_share_view", { p_share_id: shareId });
}

export function subscribeToNotifications(
  userId: string,
  onNew: (n: AppNotification) => void,
): RealtimeChannel {
  return supabase
    .channel(`notifications:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => onNew(payload.new as AppNotification),
    )
    .subscribe();
}
