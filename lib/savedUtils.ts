import { supabase } from "./supabase";

async function getUserKey(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  return `saved-${user?.id ?? "guest"}`;
}

export async function toggleSaved(photoId: string): Promise<boolean> {
  const key = await getUserKey();
  const saved: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
  const idx = saved.indexOf(photoId);
  if (idx >= 0) {
    saved.splice(idx, 1);
    localStorage.setItem(key, JSON.stringify(saved));
    return false;
  } else {
    saved.push(photoId);
    localStorage.setItem(key, JSON.stringify(saved));
    return true;
  }
}

export async function getSavedIds(): Promise<Set<string>> {
  const key = await getUserKey();
  const saved: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
  return new Set(saved);
}
