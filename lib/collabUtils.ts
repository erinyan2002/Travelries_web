import { supabase } from "./supabase";
import { MapPhoto } from "./types";

export type CollabAlbum = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  invite_code: string;
  created_at: string;
  role?: "owner" | "contributor" | "viewer";
};

export type CollabMember = {
  id: string;
  album_id: string;
  user_id: string;
  email: string | null;
  role: "owner" | "contributor" | "viewer";
  joined_at: string;
};

export type CollabPhoto = {
  id: string;
  album_id: string;
  added_by: string | null;
  added_by_email: string | null;
  file_name: string;
  image_url: string;
  location: string | null;
  capture_date: string | null;
  face_count: number;
  added_at: string;
};

function base64ToBlob(dataUrl: string): { blob: Blob; mimeType: string } {
  const [header, data] = dataUrl.split(",");
  const mimeType = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const binary = atob(data);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return { blob: new Blob([arr], { type: mimeType }), mimeType };
}

export async function createAlbum(name: string, description: string): Promise<CollabAlbum> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: album, error } = await supabase
    .from("collab_albums")
    .insert({ owner_id: user.id, name, description: description || null })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  const { error: memberError } = await supabase.from("collab_members").insert({
    album_id: album.id,
    user_id: user.id,
    email: user.email ?? null,
    role: "owner",
  });
  if (memberError) throw new Error(memberError.message);

  return { ...album, role: "owner" };
}

export async function getMyAlbums(): Promise<CollabAlbum[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: memberships, error: mErr } = await supabase
    .from("collab_members")
    .select("album_id, role")
    .eq("user_id", user.id);
  if (mErr || !memberships?.length) return [];

  const albumIds = memberships.map((m) => m.album_id as string);
  const roleMap: Record<string, CollabAlbum["role"]> = Object.fromEntries(
    memberships.map((m) => [m.album_id as string, m.role as CollabAlbum["role"]])
  );

  const { data: albums, error } = await supabase
    .from("collab_albums")
    .select("*")
    .in("id", albumIds)
    .order("created_at", { ascending: false });
  if (error || !albums) return [];

  return albums.map((a) => ({ ...a, role: roleMap[a.id] }));
}

export async function getAlbum(id: string): Promise<CollabAlbum | null> {
  const { data: { user } } = await supabase.auth.getUser();

  const { data: album, error } = await supabase
    .from("collab_albums")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !album) return null;

  if (user) {
    const { data: membership } = await supabase
      .from("collab_members")
      .select("role")
      .eq("album_id", id)
      .eq("user_id", user.id)
      .single();
    return { ...album, role: membership?.role as CollabAlbum["role"] | undefined };
  }
  return album as CollabAlbum;
}

export async function getAlbumMembers(albumId: string): Promise<CollabMember[]> {
  const { data, error } = await supabase
    .from("collab_members")
    .select("*")
    .eq("album_id", albumId)
    .order("joined_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CollabMember[];
}

export async function getAlbumPhotos(albumId: string): Promise<CollabPhoto[]> {
  const { data, error } = await supabase
    .from("collab_photos")
    .select("*")
    .eq("album_id", albumId)
    .order("added_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CollabPhoto[];
}

export async function addPhotoToAlbum(albumId: string, photo: MapPhoto): Promise<CollabPhoto> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  let imageUrl = photo.imageUrl;
  if (imageUrl.startsWith("data:")) {
    const { blob, mimeType } = base64ToBlob(imageUrl);
    const ext = mimeType.split("/")[1] ?? "jpg";
    const path = `${user.id}/${albumId}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("collab-photos")
      .upload(path, blob, { contentType: mimeType });
    if (uploadError) throw new Error(uploadError.message);
    const { data: { publicUrl } } = supabase.storage.from("collab-photos").getPublicUrl(path);
    imageUrl = publicUrl;
  }

  const { data, error } = await supabase
    .from("collab_photos")
    .insert({
      album_id: albumId,
      added_by: user.id,
      added_by_email: user.email ?? null,
      file_name: photo.fileName,
      image_url: imageUrl,
      location: photo.location ?? null,
      capture_date: photo.captureDate ?? null,
      face_count: photo.faceCount ?? 0,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as CollabPhoto;
}

export async function removePhotoFromAlbum(photoId: string): Promise<void> {
  const { error } = await supabase.from("collab_photos").delete().eq("id", photoId);
  if (error) throw new Error(error.message);
}

export async function joinAlbumByCode(inviteCode: string): Promise<string> {
  const { data, error } = await supabase.rpc("join_collab_album", { p_invite_code: inviteCode.trim() });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function leaveAlbum(albumId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase
    .from("collab_members")
    .delete()
    .eq("album_id", albumId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
}

export async function deleteAlbum(albumId: string): Promise<void> {
  const { error } = await supabase.from("collab_albums").delete().eq("id", albumId);
  if (error) throw new Error(error.message);
}

export async function removeMember(albumId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("collab_members")
    .delete()
    .eq("album_id", albumId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
