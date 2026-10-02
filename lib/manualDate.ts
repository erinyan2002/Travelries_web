// A capture date picked by hand for a photo with no EXIF date (a screenshot, a
// photo sent through a messenger, a photo-booth print). Without it, such a photo
// fell back to its upload time, so yesterday's photo uploaded today landed on today.

/** "YYYY-MM-DD" for an <input type="date">, in local time. */
export function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The capture fields for a hand-picked day. The time isn't known, so it's noon
 *  local (safe from timezone day shifts) and captureTime stays unset. */
export function captureFromDateInput(value: string, locale?: string): { captureTimestamp: string; captureDate: string } | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  if (isNaN(d.getTime())) return null;
  return { captureTimestamp: d.toISOString(), captureDate: d.toLocaleDateString(locale) };
}

/** Moves a timestamp to another calendar day, keeping its local time of day
 *  (editing a saved photo's date shouldn't lose the hour it was taken). */
export function withDay(iso: string, value: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = new Date(iso);
  if (!m || isNaN(t.getTime())) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), t.getHours(), t.getMinutes(), t.getSeconds()).toISOString();
}
