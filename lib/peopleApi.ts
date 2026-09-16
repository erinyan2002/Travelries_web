// Persisted person identities for the Faces page's manual "merge"/"tag at upload"
// override (see supabase/migrations/0010_face_person_grouping.sql). A person here
// is only created once a user explicitly merges two auto-clusters or tags a face
// with an existing person — clusters with no manual override still come purely
// from clusterByPerson()'s descriptor-distance grouping in app/faces/page.tsx.
import { supabase } from "./supabase";

export type Person = { id: string; name: string; createdAt: string };

export async function fetchPeople(uid: string): Promise<Person[]> {
  const { data, error } = await supabase
    .from("people")
    .select("id, name, created_at")
    .eq("user_id", uid)
    .order("name");
  if (error) {
    console.error("fetchPeople failed:", error);
    return [];
  }
  return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string, createdAt: r.created_at as string }));
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
