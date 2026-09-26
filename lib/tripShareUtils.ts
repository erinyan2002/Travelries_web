// Public whole-trip share links (/trip/[id]) — see
// supabase/migrations/0013_trip_shares.sql for the snapshot model.
import { supabase, getSessionUser } from "./supabase";
import { Trip, getPhotoDate } from "./trips";

export type TripSharePhoto = {
  imageUrl: string;
  fileName: string;
  location: string | null;
  captureDate: string | null;
  takenAt: string | null; // ISO, for ordering the route
  lat: number | null;
  lng: number | null;
};

export type TripShare = {
  id: string;
  title: string;
  dateRange: string | null;
  locations: string[];
  diary: string | null;
  photos: TripSharePhoto[];
  createdAt: string;
};

export async function shareTrip(trip: Trip, diary: string | null): Promise<string> {
  const { data: { user } } = await getSessionUser();
  if (!user) throw new Error("Not signed in");

  const photos: TripSharePhoto[] = [...trip.photos]
    // An inline base64 image would bloat the row and can't be linked to publicly;
    // migrateInlineImages (lib/photosApi.ts) moves those to Storage on Home load.
    .filter((p) => !p.imageUrl.startsWith("data:"))
    .sort((a, b) => getPhotoDate(a).getTime() - getPhotoDate(b).getTime())
    .map((p) => {
      const t = getPhotoDate(p);
      return {
        imageUrl: p.imageUrl,
        fileName: p.fileName,
        location: p.location ?? null,
        captureDate: p.captureDate ?? null,
        takenAt: t.getTime() > 0 ? t.toISOString() : null,
        lat: p.lat ?? null,
        lng: p.lng ?? null,
      };
    });
  if (photos.length === 0) throw new Error("This trip has no shareable photos yet.");

  const { data, error } = await supabase
    .from("trip_shares")
    .insert({
      user_id: user.id,
      title: trip.name,
      date_range: trip.dateRange,
      locations: trip.locations,
      diary,
      photos,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return `${window.location.origin}/trip/${data.id}`;
}

export async function getTripShare(id: string): Promise<TripShare | null> {
  const { data, error } = await supabase
    .from("trip_shares")
    .select("id, title, date_range, locations, diary, photos, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id as string,
    title: data.title as string,
    dateRange: (data.date_range as string | null) ?? null,
    locations: (data.locations as string[] | null) ?? [],
    diary: (data.diary as string | null) ?? null,
    photos: (data.photos as TripSharePhoto[] | null) ?? [],
    createdAt: data.created_at as string,
  };
}
