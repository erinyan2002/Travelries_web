// AI travel diary: shared by the Albums trip cards and the trip page's Diary tab.
// Checks the trip_diaries cache first and only calls the backend on a miss.
import { BACKEND_URL } from "./backend";
import { fetchTripDiary, saveTripDiary } from "./photosApi";
import { MapPhoto } from "./types";

export type DiaryLang = "en" | "ko";
export const DIARY_LANGS: { value: DiaryLang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ko", label: "한국어" },
];
export const DIARY_LANG_STORAGE = "diary-lang";

export function loadDiaryLang(): DiaryLang {
  try {
    const v = typeof window !== "undefined" ? localStorage.getItem(DIARY_LANG_STORAGE) : null;
    return v === "ko" || v === "en" ? v : "en";
  } catch { return "en"; }
}

export function storeDiaryLang(lang: DiaryLang) {
  try { localStorage.setItem(DIARY_LANG_STORAGE, lang); } catch { /* storage unavailable — fine */ }
}

// trip_diaries is unique per (user_id, trip_key), so the cache key carries the
// photo set, a version and the language. "v2" = diaries written by a model that
// SEES the photos (v1 only got text metadata and tended to describe just one of
// several same-place photos) — bumping it makes old v1 diaries regenerate once.
export function diaryCacheKey(photoSetKey: string, lang: DiaryLang): string {
  return `${photoSetKey}|v2|${lang}`;
}

export function photoSetKey(photos: MapPhoto[]): string {
  return photos.map((p) => p.id).sort().join(",");
}

export type DiaryResult = { text: string; cached: boolean };

/** Throws an Error whose message is ready to show the user. */
export async function requestDiary(
  uid: string | null, photos: MapPhoto[], lang: DiaryLang, forceRegenerate = false,
): Promise<DiaryResult> {
  const key = diaryCacheKey(photoSetKey(photos), lang);
  if (!forceRegenerate && uid) {
    const cached = await fetchTripDiary(uid, key);
    if (cached) return { text: cached, cached: true };
  }
  let data: { diary?: string; error?: string };
  try {
    const res = await fetch(`${BACKEND_URL}/generate-diary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: lang,
        entries: photos.map((p) => ({
          fileName: p.fileName,
          imageUrl: p.imageUrl.startsWith("data:") ? undefined : p.imageUrl,
          location: p.location,
          captureDate: p.captureDate,
          captureTime: p.captureTime,
          faceCount: p.faceCount ?? 0,
        })),
      }),
    });
    data = await res.json();
  } catch {
    throw new Error("Couldn't connect to the backend server (uvicorn may be offline).");
  }
  if (!data.diary) throw new Error(data.error ?? "Couldn't generate the diary. Please try again in a moment.");
  // Caching is best-effort: a failed save must not turn a successfully
  // generated diary into an error.
  if (uid) saveTripDiary(uid, key, data.diary, lang).catch((err) => console.warn("Caching diary failed:", err));
  return { text: data.diary, cached: false };
}
