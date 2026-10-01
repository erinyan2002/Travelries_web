// A photo without GPS (a photo-booth print, a screenshot, a camera with location
// off) usually sits next to photos that have it. This picks the located photo
// taken closest in time, as the place for the unlocated one.

export type LocatedShot = { takenAt: string; lat: number; lng: number; location?: string; label: string };

// Wider than a few hours and the guess often lands in the previous city.
export const GUESS_MAX_GAP_MS = 3 * 60 * 60 * 1000;

export function guessLocationByTime(
  takenAt: string | undefined,
  shots: LocatedShot[],
  maxGapMs = GUESS_MAX_GAP_MS,
): (LocatedShot & { gapMs: number }) | null {
  const t = takenAt ? Date.parse(takenAt) : NaN;
  if (Number.isNaN(t)) return null;
  let best: (LocatedShot & { gapMs: number }) | null = null;
  for (const s of shots) {
    const st = Date.parse(s.takenAt);
    if (Number.isNaN(st)) continue;
    const gapMs = Math.abs(st - t);
    if (gapMs <= maxGapMs && (!best || gapMs < best.gapMs)) best = { ...s, gapMs };
  }
  return best;
}

type Translate = (en: string, vars?: Record<string, string | number>) => string;
const english: Translate = (en, vars) => en.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));

/** `t` is the UI translator (useLang().t); English without it. */
export function describeGap(ms: number, t: Translate = english): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return t("at the same time");
  if (min < 60) return t("{n} min apart", { n: min });
  return t("{n} h apart", { n: Math.round(min / 6) / 10 });
}
