// Albums search: "Sokcho with Minji", "June 2026", "expo tower", "Minji 2025".
// The query is split into words; a photo matches when EVERY word matches something
// about it: a month or year it was taken, a named person in it, or its place,
// landmark or file name. Pure logic, see lib/photoSearch.test.ts.
import { getPhotoDate } from "./trips";
import { FacePhoto, MapPhoto } from "./types";
import type { Person } from "./peopleApi";

const STOPWORDS = new Set(["with", "and", "in", "at", "on", "the", "of", "from", "photos", "photo", "pics", "&", "+"]);

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function monthOf(token: string): number | null {
  const kor = token.match(/^(\d{1,2})월$/); // "6월"
  if (kor) { const m = Number(kor[1]); return m >= 1 && m <= 12 ? m - 1 : null; }
  if (token.length < 3) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(token));
  return i === -1 ? null : i;
}

function yearOf(token: string): number | null {
  const m = token.match(/^((?:19|20)\d{2})년?$/);
  return m ? Number(m[1]) : null;
}

export type TokenKind = "month" | "year" | "person" | "place" | "text";
export type QueryToken = { raw: string; kind: TokenKind };

export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/[\s,]+/).map((t) => t.trim()).filter((t) => t && !STOPWORDS.has(t));
}

/** photo id → names of the people tagged in it (only named/confirmed people). */
export function personNamesByPhoto(facePhotos: FacePhoto[], people: Person[]): Map<string, string[]> {
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const out = new Map<string, string[]>();
  for (const f of facePhotos) {
    const names = [...new Set((f.personIds ?? []).map((id) => (id ? nameOf.get(id) : undefined)).filter((n): n is string => !!n))];
    if (names.length > 0) out.set(f.id, names);
  }
  return out;
}

function textOf(p: MapPhoto): string {
  return [p.location, p.landmarkName, p.landmarkDescription, p.fileName].filter(Boolean).join(" ").toLowerCase();
}

/** How each word will be matched — shown as chips under the search box. */
export function describeQuery(query: string, knownPeople: string[]): QueryToken[] {
  const people = knownPeople.map((n) => n.toLowerCase());
  return tokenize(query).map((raw) => {
    if (yearOf(raw) !== null) return { raw, kind: "year" };
    if (monthOf(raw) !== null) return { raw, kind: "month" };
    if (people.some((n) => n.split(/\s+/).some((part) => part.startsWith(raw)))) return { raw, kind: "person" };
    return { raw, kind: "place" };
  });
}

export function matchesQuery(photo: MapPhoto, query: string, peopleInPhoto: string[] = []): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  const d = getPhotoDate(photo);
  const hasDate = d.getTime() > 0;
  const text = textOf(photo);
  const people = peopleInPhoto.map((n) => n.toLowerCase());
  return tokens.every((t) => {
    const y = yearOf(t);
    if (y !== null) return hasDate && d.getFullYear() === y;
    const m = monthOf(t);
    // "may" is also a word; a month-looking token still matches places/people.
    if (m !== null && hasDate && d.getMonth() === m) return true;
    if (people.some((n) => n.split(/\s+/).some((part) => part.startsWith(t)))) return true;
    return text.includes(t);
  });
}
