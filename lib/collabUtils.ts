import { supabase } from "./supabase";
import { MapPhoto } from "./types";
import { base64ToBlob } from "./imageUtils";

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

export type CollabReaction = {
  id: string;
  photo_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type CollabComment = {
  id: string;
  photo_id: string;
  user_id: string;
  user_email: string | null;
  content: string;
  created_at: string;
};

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

// The album this user already belongs to under `code`, if any. Members can read
// their own albums under RLS; for a non-member this just comes back empty.
async function memberAlbumIdForCode(uid: string, code: string): Promise<string | null> {
  const { data: album } = await supabase.from("collab_albums").select("id").eq("invite_code", code).maybeSingle();
  if (!album) return null;
  const { data: membership } = await supabase
    .from("collab_members").select("role").eq("album_id", album.id).eq("user_id", uid).maybeSingle();
  return membership ? (album.id as string) : null;
}

export async function joinAlbumByCode(inviteCode: string): Promise<string> {
  const code = inviteCode.trim().toLowerCase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please log in again to join an album.");

  // join_collab_album inserts a membership row unconditionally, so joining an
  // album you're already in (e.g. your own — the creator is added as owner)
  // failed with a raw duplicate-key error. Just open that album instead.
  const existing = await memberAlbumIdForCode(user.id, code);
  if (existing) return existing;

  const { data, error } = await supabase.rpc("join_collab_album", { p_invite_code: code });
  if (error) {
    if (error.code === "23505") {
      const again = await memberAlbumIdForCode(user.id, code);
      if (again) return again;
    }
    if (/invalid invite code/i.test(error.message)) throw new Error("That invite code doesn't match any album. Check it and try again.");
    throw new Error(error.message);
  }
  // Resolve the album by invite code now that we're a member, rather than
  // trusting the RPC's return value (whose shape isn't defined in this repo).
  const joined = await memberAlbumIdForCode(user.id, code);
  if (joined) return joined;
  if (typeof data === "string" && data) return data;
  throw new Error("You joined, but the album isn't visible yet. Run supabase/migrations/0014_collab_member_read_access.sql, then try again.");
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

export async function getReactions(photoId: string): Promise<CollabReaction[]> {
  const { data } = await supabase.from("collab_reactions").select("*").eq("photo_id", photoId);
  return (data ?? []) as CollabReaction[];
}

export async function toggleReaction(photoId: string, emoji: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: existing } = await supabase
    .from("collab_reactions").select("id")
    .eq("photo_id", photoId).eq("user_id", user.id).eq("emoji", emoji).maybeSingle();
  if (existing) {
    await supabase.from("collab_reactions").delete().eq("id", existing.id);
    return false;
  }
  await supabase.from("collab_reactions").insert({ photo_id: photoId, user_id: user.id, emoji });
  return true;
}

export async function getComments(photoId: string): Promise<CollabComment[]> {
  const { data } = await supabase
    .from("collab_comments").select("*").eq("photo_id", photoId)
    .order("created_at", { ascending: true });
  return (data ?? []) as CollabComment[];
}

export async function addComment(photoId: string, content: string): Promise<CollabComment> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("collab_comments")
    .insert({ photo_id: photoId, user_id: user.id, user_email: user.email ?? null, content })
    .select("*").single();
  if (error) throw new Error(error.message);
  return data as CollabComment;
}
