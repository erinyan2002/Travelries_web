// "Travel Memory" summary for the trip page (app/albums/trip/[id]): title, day-by-day
// journey, distance and highlights, all derived from a Trip's photos. Pure logic —
// see lib/tripMemory.test.ts.
import { Trip, getPhotoDate, haversineKm } from "./trips";
import { MapPhoto } from "./types";

// Location strings come in two shapes:
// - browser reverseGeocode (lib/uploadHelpers.ts): "road, neighbourhood, district, city"
// - the backend's Nominatim address: "road, village, county/city, province, postcode, country",
//   e.g. "Bukhangang-ro, Yangsu-ri, Yangpyeong-gun, Gyeonggi, 12280, South Korea"
// Postcodes, a trailing country and a trailing province are dropped, so the last
// remaining part is the city in both.
const COUNTRIES = new Set([
  "south korea", "korea", "republic of korea", "대한민국", "한국", "japan", "日本", "china", "中国", "taiwan",
  "hong kong", "vietnam", "thailand", "singapore", "philippines", "indonesia", "malaysia", "myanmar",
  "united states", "united states of america", "usa", "canada", "mexico", "united kingdom", "france",
  "germany", "italy", "spain", "portugal", "switzerland", "netherlands", "australia", "new zealand",
]);
const PROVINCE = /(-do|\bstate|\bprovince|\bprefecture|\bregion|metropolitan france|île-de-france)$|^(north|south) (chungcheong|jeolla|gyeongsang)$|^(gyeonggi|gangwon|jeju|jeonbuk)$/i;

function locationParts(p: MapPhoto): string[] {
  const parts = (p.location ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    // Postcodes and a GPS-only fallback ("37.123456, 127.123456") aren't place names.
    .filter((s) => !/^-?\d+(\.\d+)?$/.test(s) && !/^\d{3}-?\d{2,3}$/.test(s));
  if (parts.length > 1 && COUNTRIES.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  while (parts.length > 1 && PROVINCE.test(parts[parts.length - 1])) parts.pop();
  return parts;
}

export function cityOf(p: MapPhoto): string | null {
  const parts = locationParts(p);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

/** A human place name for one photo: a recognized landmark, else the
 *  neighbourhood/district (roads read poorly in a journey line), else the city. */
export function placeLabel(p: MapPhoto): string | null {
  if (p.landmarkName) return p.landmarkName;
  const parts = locationParts(p);
  if (parts.length >= 3) return parts[parts.length - 2];
  return parts[0] ?? null;
}

/** Stable id for a trip in a URL: its earliest photo. The trip grouping is
 *  recomputed on each page, so the page finds the trip containing this photo. */
export function tripAnchorId(trip: Trip): string {
  return sortChronologically(trip.photos)[0].id;
}

export function sortChronologically(photos: MapPhoto[]): MapPhoto[] {
  return [...photos].sort((a, b) => getPhotoDate(a).getTime() - getPhotoDate(b).getTime());
}

function mostCommon(values: (string | null)[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: { value: string; count: number } | null = null;
  for (const [value, count] of counts) if (!best || count > best.count) best = { value, count };
  return best;
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export type JourneyStop = { place: string; time: Date; photoIds: string[] };
export type TripDay = { day: number; date: Date; stops: JourneyStop[]; photos: MapPhoto[] };

export type TripMemory = {
  /** English title ("Sokcho Trip"); show it with tripTitle() for the UI language. */
  title: string;
  /** The trip's main city, admin suffix stripped ("Sokcho"). */
  city: string;
  start: Date;
  end: Date;
  dayCount: number;
  photoCount: number;
  places: string[];
  mostVisited: { place: string; photos: number } | null;
  distanceKm: number;
  days: TripDay[];
  /** Whole-trip place sequence, consecutive repeats merged. */
  journey: string[];
  /** Chronological GPS points, for the route map. */
  route: { lat: number; lng: number }[];
};

export function summarizeTrip(trip: Trip): TripMemory {
  const photos = sortChronologically(trip.photos);
  const start = getPhotoDate(photos[0]);
  const end = getPhotoDate(photos[photos.length - 1]);

  const city = mostCommon(photos.map(cityOf))?.value ?? trip.name;
  // "Sokcho-si" → "Sokcho": the romanized Korean admin suffix reads oddly in a title.
  const cityName = city.replace(/-(si|gun)$/i, "");
  const title = `${cityName} Trip`;

  // Days are numbered by calendar distance from the first day, so a day with no
  // photos leaves a gap (Day 1, Day 3) rather than renumbering.
  const firstDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const byDay = new Map<string, TripDay>();
  for (const p of photos) {
    const d = getPhotoDate(p);
    const key = localDayKey(d);
    if (!byDay.has(key)) {
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      byDay.set(key, { day: Math.round((dayStart - firstDay) / 86400000) + 1, date: d, stops: [], photos: [] });
    }
    const day = byDay.get(key)!;
    day.photos.push(p);
    const place = placeLabel(p);
    if (!place) continue;
    const last = day.stops[day.stops.length - 1];
    if (last && last.place === place) last.photoIds.push(p.id);
    else day.stops.push({ place, time: d, photoIds: [p.id] });
  }
  const days = [...byDay.values()];

  const journey: string[] = [];
  for (const d of days) for (const s of d.stops) if (journey[journey.length - 1] !== s.place) journey.push(s.place);

  const route = photos
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({ lat: p.lat!, lng: p.lng! }));
  let distanceKm = 0;
  for (let i = 1; i < route.length; i++) {
    distanceKm += haversineKm(route[i - 1].lat, route[i - 1].lng, route[i].lat, route[i].lng);
  }

  const top = mostCommon(photos.map(placeLabel));
  return {
    title,
    city: cityName,
    start,
    end,
    dayCount: days.length === 0 ? 0 : days[days.length - 1].day,
    photoCount: photos.length,
    places: [...new Set(photos.map(placeLabel).filter((x): x is string => !!x))],
    mostVisited: top ? { place: top.value, photos: top.count } : null,
    distanceKm,
    days,
    journey,
    route,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sokcho Trip" / "Sokcho 여행", with the UI translator (useLang().t). */
export function tripTitle(m: { city: string }, t: (en: string, vars?: Record<string, string>) => string): string {
  return t("{city} Trip", { city: m.city });
}

/** "Jun 2 – Jun 7, 2026", "Jun 2, 2026", or across years "Dec 30, 2025 – Jan 2, 2026";
 *  in Korean "2026년 6월 2일 – 6월 7일". */
export function formatTripDates(start: Date, end: Date, lang: "en" | "ko" = "en"): string {
  if (lang === "ko") {
    const ymd = (d: Date) => `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
    if (localDayKey(start) === localDayKey(end)) return ymd(start);
    if (start.getFullYear() !== end.getFullYear()) return `${ymd(start)} – ${ymd(end)}`;
    return `${ymd(start)} – ${end.getMonth() + 1}월 ${end.getDate()}일`;
  }
  const md = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (localDayKey(start) === localDayKey(end)) return `${md(start)}, ${start.getFullYear()}`;
  if (start.getFullYear() !== end.getFullYear()) return `${md(start)}, ${start.getFullYear()} – ${md(end)}, ${end.getFullYear()}`;
  return `${md(start)} – ${md(end)}, ${end.getFullYear()}`;
}

export function formatDistance(km: number): string {
  // 0 means no movement could be measured (photos without GPS, or all pinned to
  // one place by hand), not "stayed put": "0 m traveled" read as a bug.
  if (km === 0) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
