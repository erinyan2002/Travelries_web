// Trip detection for the Albums "Trips" view: photos are split into trips where a
// calendar day has no photos, then each trip is split again by region.
import { MapPhoto } from "./types";

// Stable cache key for a trip's diary — the trip grouping itself is recomputed
// client-side from the currently filtered photo list, so trip.id (an array index)
// isn't safe to persist against. The sorted photo-id set is.
export function tripKeyOf(trip: Trip): string {
  return trip.photos.map((p) => p.id).sort().join(",");
}

export type Trip = {
  id: string;
  name: string;
  dateRange: string;
  photos: MapPhoto[];
  locations: string[];
};

export function getPhotoDate(p: MapPhoto): Date {
  // captureTimestamp (ISO) first — captureDate is a locale-formatted display
  // string and only parsed below as a fallback for rows saved before it existed.
  if (p.captureTimestamp) {
    const t = new Date(p.captureTimestamp);
    if (!isNaN(t.getTime())) return t;
  }
  const raw = (p.captureDate && p.captureDate !== "Not available" && p.captureDate !== "날짜 없음")
    ? p.captureDate : p.uploadedAt;
  if (!raw) return new Date(0);
  let d = new Date(raw);
  if (isNaN(d.getTime())) {
    const m = raw.match(/(\d{4})[.\-\s]+(\d{1,2})[.\-\s]+(\d{1,2})/);
    if (m) d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
  }
  return isNaN(d.getTime()) ? new Date(0) : d;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function clusterByGps(photos: MapPhoto[], radiusKm = 1.5): { centLat: number; centLng: number; photos: MapPhoto[]; name: string }[] {
  const clusters: { centLat: number; centLng: number; photos: MapPhoto[]; name: string }[] = [];
  const noGps: MapPhoto[] = [];

  for (const photo of photos) {
    if (photo.lat == null || photo.lng == null) { noGps.push(photo); continue; } // 0 is a valid coordinate
    let nearest: typeof clusters[0] | null = null;
    let minDist = Infinity;
    for (const c of clusters) {
      const d = haversineKm(photo.lat, photo.lng, c.centLat, c.centLng);
      if (d < minDist) { minDist = d; nearest = c; }
    }
    if (nearest && minDist <= radiusKm) {
      const n = nearest.photos.length + 1;
      nearest.centLat = (nearest.centLat * (n - 1) + photo.lat) / n;
      nearest.centLng = (nearest.centLng * (n - 1) + photo.lng) / n;
      nearest.photos.push(photo);
    } else {
      clusters.push({ centLat: photo.lat, centLng: photo.lng, photos: [photo], name: photo.location?.split(",")[0]?.trim() || "Unknown" });
    }
  }

  if (noGps.length > 0) {
    if (clusters.length > 0) {
      clusters.reduce((a, b) => a.photos.length >= b.photos.length ? a : b).photos.push(...noGps);
    } else {
      clusters.push({ centLat: 0, centLng: 0, photos: noGps, name: "Unknown location" });
    }
  }

  return clusters.sort((a, b) => b.photos.length - a.photos.length);
}

// How far apart photos taken in the same days can be and still be one trip. It
// was the 1.5 km default of clusterByGps, which is place-sized: two photos from
// the same day in Sokcho (a beach and the town) came out as two "Sokcho Trip"
// cards. 40 km keeps one city, or a city and its day trips, together and still
// splits Seoul from Busan or Sokcho in the same week. Places within a trip are
// listed on the trip page (lib/tripMemory.ts).
export const TRIP_RADIUS_KM = 40;

// Calendar days between two dates in local time (Sep 29 23:00 → Sep 30 01:00 is 1).
function calendarDayGap(a: Date, b: Date): number {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(b) - day(a)) / 86400000);
}

// Photos on consecutive days are one trip (Sep 29, 30, Oct 1); a day with no
// photos in between starts a new one. It used to be "more than 4 days apart",
// which also joined a weekend outing to the next week's.
export const MAX_TRIP_DAY_GAP = 1;

export function detectTrips(photos: MapPhoto[], maxDayGap = MAX_TRIP_DAY_GAP): Trip[] {
  if (photos.length === 0) return [];
  const dated = photos
    .map(p => ({ photo: p, date: getPhotoDate(p) }))
    .filter(({ date }) => date.getTime() > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (dated.length === 0) return [];

  // Step 1: group by date gap
  const dateGroups: { photo: MapPhoto; date: Date }[][] = [];
  let current: { photo: MapPhoto; date: Date }[] = [];
  for (const item of dated) {
    if (current.length === 0) { current.push(item); continue; }
    if (calendarDayGap(current[current.length - 1].date, item.date) > maxDayGap) { dateGroups.push(current); current = [item]; }
    else current.push(item);
  }
  if (current.length > 0) dateGroups.push(current);

  const fmt = (d: Date) =>
    `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;

  const trips: Trip[] = [];

  // Step 2: within each date group, split by region (TRIP_RADIUS_KM apart)
  for (const group of dateGroups) {
    const ps = group.map(g => g.photo);
    const ds = group.map(g => g.date);
    const start = ds[0], end = ds[ds.length - 1];
    const range = fmt(start) === fmt(end) ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;

    const locClusters = clusterByGps(ps, TRIP_RADIUS_KM);

    for (const lc of locClusters) {
      const clusterDates = lc.photos.map(p => getPhotoDate(p)).filter(d => d.getTime() > 0).sort((a, b) => a.getTime() - b.getTime());
      const cStart = clusterDates[0] ?? start;
      const cEnd = clusterDates[clusterDates.length - 1] ?? end;
      const cRange = locClusters.length === 1
        ? range
        : fmt(cStart) === fmt(cEnd) ? fmt(cStart) : `${fmt(cStart)} – ${fmt(cEnd)}`;
      const locs = [...new Set(lc.photos.map(p => p.location?.split(",")[0]?.trim()).filter(Boolean))] as string[];
      trips.push({ id: `trip-${trips.length}`, name: lc.name, dateRange: cRange, photos: lc.photos, locations: locs });
    }
  }

  return trips.reverse();
}
