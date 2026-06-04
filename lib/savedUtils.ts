import { supabase } from "./supabase";

async function getUserKey(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  return `saved-${user?.id ?? "guest"}`;
}

// Removes a photo from all localStorage keys (map, faces, saved) and collab_photos in Supabase.
export async function deletePhotoEverywhere(photoId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id ?? "guest";

  const mapKey   = `map-${uid}`;
  const facesKey = `faces-${uid}`;
  const savedKey = `saved-${uid}`;

  const maps   = JSON.parse(localStorage.getItem(mapKey)   ?? "[]");
  const faces  = JSON.parse(localStorage.getItem(facesKey) ?? "[]");
  const saved: string[] = JSON.parse(localStorage.getItem(savedKey) ?? "[]");

  // Capture fileName before removing from map, needed for collab deletion
  const photoMeta: { id: string; fileName?: string } | undefined =
    maps.find((p: { id: string }) => p.id === photoId);

  const fileNameToDelete = photoMeta?.fileName;

  localStorage.setItem(mapKey,   JSON.stringify(maps.filter((p: { id: string }) => p.id !== photoId)));
  // Delete face entry by id OR by fileName (map and faces may have been saved with different UUIDs)
  localStorage.setItem(facesKey, JSON.stringify(
    faces.filter((p: { id: string; fileName?: string }) => {
      if (p.id === photoId) return false;
      if (fileNameToDelete && p.fileName === fileNameToDelete) return false;
      return true;
    })
  ));
  localStorage.setItem(savedKey, JSON.stringify(saved.filter((id) => id !== photoId)));

  // Delete from collab_photos where this user uploaded a photo with the same filename
  if (photoMeta?.fileName && uid !== "guest") {
    await supabase
      .from("collab_photos")
      .delete()
      .eq("added_by", uid)
      .eq("file_name", photoMeta.fileName);
  }
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
