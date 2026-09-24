// Supabase-backed replacement for the old `map-<uid>` / `faces-<uid>` localStorage
// arrays. Both "views" (map, faces) read from the same public.photos table — a
// photo row can be a map photo, a face photo, or both, via is_map_photo/is_face_photo.
import { supabase } from "./supabase";
import { MapPhoto, FacePhoto, rowToMapPhoto, rowToFacePhoto } from "./types";
import { base64ToBlob } from "./imageUtils";

export async function currentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function fetchPhotoRows(uid: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from("photos")
    .select("*")
    .eq("user_id", uid)
    .order("uploaded_at", { ascending: false });
  if (error) {
    console.error("fetchPhotoRows failed:", error);
    return [];
  }
  return data ?? [];
}

export async function fetchMapPhotos(uid: string): Promise<MapPhoto[]> {
  return (await fetchPhotoRows(uid)).filter((r) => r.is_map_photo).map(rowToMapPhoto);
}

export async function fetchFacePhotos(uid: string): Promise<FacePhoto[]> {
  return (await fetchPhotoRows(uid)).filter((r) => r.is_face_photo).map(rowToFacePhoto);
}

// Specific photos as MapPhoto regardless of is_map_photo — e.g. every photo a
// person appears in, including face-only saves that were never added to the map.
export async function fetchPhotosByIds(uid: string, ids: Set<string>): Promise<MapPhoto[]> {
  return (await fetchPhotoRows(uid)).filter((r) => ids.has(r.id as string)).map(rowToMapPhoto);
}

// Every photo row as MapPhoto (map photos and face-only saves alike).
export async function fetchEveryPhoto(uid: string): Promise<MapPhoto[]> {
  return (await fetchPhotoRows(uid)).map(rowToMapPhoto);
}

// For pages that need both counts (Stats) without two round trips.
export async function fetchAllPhotos(uid: string): Promise<{ mapPhotos: MapPhoto[]; facePhotos: FacePhoto[] }> {
  const rows = await fetchPhotoRows(uid);
  return {
    mapPhotos: rows.filter((r) => r.is_map_photo).map(rowToMapPhoto),
    facePhotos: rows.filter((r) => r.is_face_photo).map(rowToFacePhoto),
  };
}

export async function fetchSavedIds(uid: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("saved_photos").select("photo_id").eq("user_id", uid);
  if (error) {
    console.error("fetchSavedIds failed:", error);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.photo_id as string));
}

export async function toggleSavedPhoto(uid: string, photoId: string): Promise<boolean> {
  const { data } = await supabase
    .from("saved_photos")
    .select("photo_id")
    .eq("user_id", uid)
    .eq("photo_id", photoId)
    .maybeSingle();
  if (data) {
    await supabase.from("saved_photos").delete().eq("user_id", uid).eq("photo_id", photoId);
    return false;
  }
  await supabase.from("saved_photos").insert({ user_id: uid, photo_id: photoId });
  return true;
}

export type PhotoUpsertInput = {
  id: string;
  fileName: string;
  imageUrl: string;
  lat?: number | null;
  lng?: number | null;
  location?: string | null;
  captureDate?: string | null;
  captureTime?: string | null;
  captureTimestamp?: string | null;
  faceCount?: number;
  isMapPhoto?: boolean;
  isFacePhoto?: boolean;
  boxes?: FacePhoto["boxes"];
  descriptors?: number[][];
  confidences?: number[];
  ages?: number[];
  genders?: string[];
  expressions?: string[];
  personIds?: (string | null)[];
  landmarkName?: string | null;
  landmarkConfidence?: string | null;
  landmarkDescription?: string | null;
  landmarkAnalyzedAt?: string;
};

// Insert-or-update by id. Only the columns present in `input` are written on an
// update (Postgres ON CONFLICT DO UPDATE), so e.g. reconciling a face-only row
// into a map+face row doesn't clobber boxes/descriptors already stored on it.
export async function upsertPhoto(uid: string, input: PhotoUpsertInput): Promise<void> {
  const row: Record<string, unknown> = {
    id: input.id,
    user_id: uid,
    file_name: input.fileName,
    image_url: input.imageUrl,
  };
  if (input.lat              !== undefined) row.lat = input.lat;
  if (input.lng              !== undefined) row.lng = input.lng;
  if (input.location         !== undefined) row.location = input.location;
  if (input.captureDate      !== undefined) row.capture_date = input.captureDate;
  if (input.captureTime      !== undefined) row.capture_time = input.captureTime;
  if (input.captureTimestamp !== undefined) row.capture_timestamp = input.captureTimestamp;
  if (input.faceCount        !== undefined) row.face_count = input.faceCount;
  if (input.isMapPhoto       !== undefined) row.is_map_photo = input.isMapPhoto;
  if (input.isFacePhoto      !== undefined) row.is_face_photo = input.isFacePhoto;
  if (input.boxes            !== undefined) row.boxes = input.boxes;
  if (input.descriptors      !== undefined) row.descriptors = input.descriptors;
  if (input.confidences      !== undefined) row.confidences = input.confidences;
  if (input.ages             !== undefined) row.ages = input.ages;
  if (input.genders          !== undefined) row.genders = input.genders;
  if (input.expressions      !== undefined) row.expressions = input.expressions;
  if (input.personIds        !== undefined) row.person_ids = input.personIds;
  if (input.landmarkName        !== undefined) row.landmark_name = input.landmarkName;
  if (input.landmarkConfidence  !== undefined) row.landmark_confidence = input.landmarkConfidence;
  if (input.landmarkDescription !== undefined) row.landmark_description = input.landmarkDescription;
  if (input.landmarkAnalyzedAt  !== undefined) row.landmark_analyzed_at = input.landmarkAnalyzedAt;

  const { error } = await supabase.from("photos").upsert(row);
  if (error) throw new Error(error.message);
}

// Thin wrapper over upsertPhoto for the Faces page's "merge people" action —
// writes the full person_ids array for one photo row (the caller is responsible
// for preserving indices it isn't touching; see handleMerge in app/faces/page.tsx).
export async function updateFacePersonIds(
  uid: string, photoId: string, fileName: string, imageUrl: string, personIds: (string | null)[],
): Promise<void> {
  await upsertPhoto(uid, { id: photoId, fileName, imageUrl, personIds });
}

// Persists a landmark-recognition result so PhotoModal never has to re-call
// /recognize-landmark for a photo that's already been analyzed.
export async function saveLandmarkResult(
  uid: string,
  photoId: string,
  result: { landmarkName: string | null; landmarkConfidence: string | null; landmarkDescription: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("photos")
    .update({
      landmark_name: result.landmarkName,
      landmark_confidence: result.landmarkConfidence,
      landmark_description: result.landmarkDescription,
      landmark_analyzed_at: new Date().toISOString(),
    })
    .eq("id", photoId)
    .eq("user_id", uid);
  if (error) throw new Error(error.message);
}

// trip_key is the sorted, comma-joined list of a trip's photo ids — stable
// regardless of array index or active filters (see detectTrips() in app/albums/page.tsx).
export async function fetchTripDiary(uid: string, tripKey: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("trip_diaries")
    .select("diary_text")
    .eq("user_id", uid)
    .eq("trip_key", tripKey)
    .maybeSingle();
  if (error) {
    console.error("fetchTripDiary failed:", error);
    return null;
  }
  return (data?.diary_text as string) ?? null;
}

export async function saveTripDiary(uid: string, tripKey: string, diaryText: string, language: string): Promise<void> {
  const { error } = await supabase
    .from("trip_diaries")
    .upsert(
      { user_id: uid, trip_key: tripKey, diary_text: diaryText, language, generated_at: new Date().toISOString() },
      { onConflict: "user_id,trip_key" },
    );
  if (error) throw new Error(error.message);
}

export async function renamePhoto(uid: string, photoId: string, fileName: string): Promise<void> {
  await supabase.from("photos").update({ file_name: fileName }).eq("id", photoId).eq("user_id", uid);
}

// Removes ONE detected face from a photo (e.g. a stranger caught in a group
// shot, or a face saved by mistake) without deleting the photo itself — it
// stays in Albums/Map exactly as before. The face's array entries can't just
// be spliced out and the rest shifted down: every OTHER face's cluster id and
// manual person tag in this app are keyed by its position in boxes/descriptors
// (see clusterByPerson/buildPersonGroups in app/faces/page.tsx) — shifting
// indices would silently reassign other people's identities on the same photo.
// Instead the removed face is "tombstoned" in place: its descriptor is cleared
// to an empty array (clusterByPerson's existing `!desc?.length` guard already
// skips those) and its personId cleared to null (buildPersonGroups' existing
// `!personId` guard already skips those) — every other index is untouched.
export async function removeFaceFromPhoto(uid: string, photoId: string, boxIndex: number): Promise<void> {
  const { data, error } = await supabase
    .from("photos")
    .select("boxes, descriptors, person_ids, face_count")
    .eq("id", photoId)
    .eq("user_id", uid)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Photo not found");

  const boxes = (data.boxes as FacePhoto["boxes"]) ?? [];
  if (boxIndex < 0 || boxIndex >= boxes.length) throw new Error("Face not found on this photo");

  const newBoxes = [...boxes];
  newBoxes[boxIndex] = { x: 0, y: 0, width: 0, height: 0 };

  const descriptors = [...(((data.descriptors as number[][]) ?? []))];
  descriptors[boxIndex] = [];

  const personIds = [...(((data.person_ids as (string | null)[]) ?? []))];
  personIds[boxIndex] = null;

  const newFaceCount = Math.max(0, ((data.face_count as number) ?? 0) - 1);

  const { error: updateError } = await supabase
    .from("photos")
    .update({
      boxes: newBoxes,
      descriptors,
      person_ids: personIds,
      face_count: newFaceCount,
      is_face_photo: newFaceCount > 0,
    })
    .eq("id", photoId)
    .eq("user_id", uid);
  if (updateError) throw new Error(updateError.message);
}

// Deletes the photo row (saved_photos cascades via its FK) and any collab_photos
// row this user shared from it.
export async function deletePhotoEverywhere(uid: string, photoId: string): Promise<void> {
  // .select() forces the delete to report which rows it actually removed — a
  // plain .delete() reports success even when RLS silently matched zero rows, which
  // would otherwise leave the row (and its is_face_photo entry) behind with no error.
  const { data, error } = await supabase.from("photos").delete().eq("id", photoId).eq("user_id", uid).select("id, image_url");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Photo not found or already deleted");

  // Matched by image_url, NOT file_name: camera filenames (IMG_1234.jpg) repeat
  // across trips/devices, and the old file_name match deleted unrelated photos —
  // other personal rows and other collab photos — that merely shared a name.
  // image_url is unique per photo (<uid>/<photoId>.<ext>), and addPhotoToAlbum
  // reuses it as-is for a Storage-hosted photo. (A base64-fallback photo gets a
  // fresh collab URL, so it's left in the collab album — never over-delete.)
  const imageUrl = data[0].image_url as string | null;
  if (imageUrl && !imageUrl.startsWith("data:")) {
    await supabase.from("collab_photos").delete().eq("added_by", uid).eq("image_url", imageUrl);
  }
}

// Uploads a photo's image to Storage and returns its public URL. Never falls back
// to storing the base64 data URL in the DB row (that bloated `photos` rows to
// ~150-300 KB each and slowed every list query) — a failed upload throws instead.
// The path is deterministic per photo id, and both the face save and Save to Map
// upload the same file for the same id, so "already exists" just means the other
// one got there first: reuse that URL.
export async function uploadToUserPhotos(uid: string, photoId: string, dataUrl: string): Promise<string> {
  const { blob, mimeType } = base64ToBlob(dataUrl);
  const ext = mimeType.split("/")[1] ?? "jpg";
  const path = `${uid}/${photoId}.${ext}`;
  const publicUrl = supabase.storage.from("user-photos").getPublicUrl(path).data.publicUrl;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.storage
      .from("user-photos")
      .upload(path, blob, { contentType: mimeType });
    if (!error) return publicUrl;
    if (/already exists|duplicate/i.test(error.message)) return publicUrl;
    lastError = error.message;
  }
  throw new Error(`Image upload failed: ${lastError}`);
}

// One-time cleanup for rows saved before uploads stopped falling back to inline
// base64 (face-only saves always stored the image inline): moves each such image
// into Storage and points the row at it. Best-effort — a row that fails is just
// left as-is and retried on the next call.
export async function migrateInlineImages(uid: string): Promise<number> {
  const { data, error } = await supabase
    .from("photos")
    .select("id")
    .eq("user_id", uid)
    .like("image_url", "data:%");
  if (error || !data?.length) return 0;
  let moved = 0;
  // One row at a time: each image_url is a few hundred KB of base64.
  for (const { id } of data as { id: string }[]) {
    try {
      const { data: row } = await supabase.from("photos").select("image_url").eq("id", id).eq("user_id", uid).single();
      const dataUrl = row?.image_url as string | undefined;
      if (!dataUrl?.startsWith("data:")) continue;
      const imageUrl = await uploadToUserPhotos(uid, id, dataUrl);
      const { error: updateError } = await supabase.from("photos").update({ image_url: imageUrl }).eq("id", id).eq("user_id", uid);
      if (updateError) throw new Error(updateError.message);
      moved++;
    } catch (err) {
      console.warn(`Moving inline image for photo ${id} to Storage failed:`, err);
    }
  }
  return moved;
}

// The manual person tags (people.id per face) on one photo — used to suggest
// post tags for a photo whose faces are linked to real accounts.
export async function fetchPhotoPersonIds(uid: string, photoId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("photos")
    .select("person_ids")
    .eq("id", photoId)
    .eq("user_id", uid)
    .maybeSingle();
  if (error || !data) return [];
  return ((data.person_ids as (string | null)[] | null) ?? []).filter((p): p is string => !!p);
}
