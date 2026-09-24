// Persisted person identities for the Faces page's manual "merge"/"tag at upload"
// override (see supabase/migrations/0010_face_person_grouping.sql). A person here
// is only created once a user explicitly merges two auto-clusters or tags a face
// with an existing person — clusters with no manual override still come purely
// from clusterByPerson()'s descriptor-distance grouping in app/faces/page.tsx.
import { supabase } from "./supabase";

// linkedUserId: an app account this person is (see 0012_people_linked_user.sql)
// — used to suggest tagging them when posting a photo with their face.
export type Person = { id: string; name: string; createdAt: string; linkedUserId?: string | null };

export async function fetchPeople(uid: string): Promise<Person[]> {
  const query = (cols: string) => supabase.from("people").select(cols).eq("user_id", uid).order("name");
  let { data, error } = await query("id, name, created_at, linked_user_id");
  // linked_user_id only exists once 0012 has been run — don't let a missing
  // migration take down the whole Faces page, just drop the link feature.
  if (error) ({ data, error } = await query("id, name, created_at"));
  if (error) {
    console.error("fetchPeople failed:", error);
    return [];
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    createdAt: r.created_at as string,
    linkedUserId: (r.linked_user_id as string | null | undefined) ?? null,
  }));
}

export async function createPerson(uid: string, name: string): Promise<Person> {
  const { data, error } = await supabase
    .from("people")
    .insert({ user_id: uid, name })
    .select("id, name, created_at")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, name: data.name as string, createdAt: data.created_at as string };
}

export async function renamePerson(personId: string, name: string): Promise<void> {
  const { error } = await supabase.from("people").update({ name }).eq("id", personId);
  if (error) throw new Error(error.message);
}

export async function linkPersonToUser(personId: string, userId: string | null): Promise<void> {
  const { error } = await supabase.from("people").update({ linked_user_id: userId }).eq("id", personId);
  if (error) throw new Error(error.message);
}
