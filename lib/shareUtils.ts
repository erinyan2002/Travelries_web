import { supabase } from "./supabase";
import { MapPhoto } from "./types";

export type ShareRecord = {
  id: string;
  file_name: string;
  image_url: string;
  location?: string | null;
  capture_date?: string | null;
  face_count: number;
  created_at: string;
};

function base64ToBlob(dataUrl: string): { blob: Blob; mimeType: string } {
  const [header, data] = dataUrl.split(",");
  const mimeType = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const binary = atob(data);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return { blob: new Blob([arr], { type: mimeType }), mimeType };
}

export async function sharePhoto(photo: MapPhoto): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id ?? "guest";

  let imageUrl = photo.imageUrl;
  if (imageUrl.startsWith("data:")) {
    const { blob, mimeType } = base64ToBlob(imageUrl);
    const ext = mimeType.split("/")[1] ?? "jpg";
    const path = `${uid}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("shares")
      .upload(path, blob, { contentType: mimeType });
    if (uploadError) throw new Error(uploadError.message);
    const { data: { publicUrl } } = supabase.storage.from("shares").getPublicUrl(path);
    imageUrl = publicUrl;
  }

  const { data, error } = await supabase
    .from("shares")
    .insert({
      user_id: uid,
      file_name: photo.fileName,
      image_url: imageUrl,
      location: photo.location ?? null,
      capture_date: photo.captureDate ?? null,
      face_count: photo.faceCount ?? 0,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return `${window.location.origin}/share/${data.id}`;
}

export async function getShare(id: string): Promise<ShareRecord | null> {
  const { data, error } = await supabase
    .from("shares")
    .select("id, file_name, image_url, location, capture_date, face_count, created_at")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as ShareRecord;
}
