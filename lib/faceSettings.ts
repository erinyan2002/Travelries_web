// The user's "Face analysis" privacy switch (Profile page). Stored in Supabase
// Auth user_metadata, so it follows the account across devices without a
// migration, and reading it is local (no network call).
import { supabase } from "./supabase";

export async function isFaceAnalysisEnabled(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user.user_metadata?.face_analysis !== false;
}

export async function setFaceAnalysisEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { face_analysis: enabled } });
  if (error) throw new Error(error.message);
}
