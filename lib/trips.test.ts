import { describe, it, expect } from "vitest";
import { detectTrips, getPhotoDate, tripKeyOf } from "./trips";
import type { MapPhoto } from "./types";

const p = (id: string, iso: string, extra: Partial<MapPhoto> = {}): MapPhoto =>
  ({ id, fileName: `${id}.jpg`, imageUrl: "", captureTimestamp: iso, lat: 37.5, lng: 127, location: "Seoul", ...extra });

describe("getPhotoDate", () => {
  it("prefers captureTimestamp over the locale-formatted captureDate", () => {
    const photo = p("a", "2026-03-05T10:00:00Z", { captureDate: "2020. 1. 1." });
    expect(getPhotoDate(photo).toISOString()).toBe("2026-03-05T10:00:00.000Z");
  });

  it("falls back to parsing a Korean-formatted captureDate", () => {
    const photo: MapPhoto = { id: "b", fileName: "", imageUrl: "", captureDate: "2025. 7. 14." };
    const d = getPhotoDate(photo);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2025, 7, 14]);
  });
});

describe("detectTrips", () => {
  it("keeps consecutive days together and splits after a day with no photos", () => {
    const trips = detectTrips([
      p("sep29", "2026-09-29T09:00:00Z"), p("sep30", "2026-09-30T09:00:00Z"), p("oct1", "2026-10-01T03:00:00Z"),
      p("oct3", "2026-10-03T03:00:00Z"),
    ]);
    expect(trips.map((t) => t.photos.map((x) => x.id))).toEqual([["oct3"], ["sep29", "sep30", "oct1"]]);
  });

  it("splits one date range into separate trips by location", () => {
    const trips = detectTrips([
      p("seoul", "2026-01-01T00:00:00Z"),
      p("busan", "2026-01-02T00:00:00Z", { lat: 35.1, lng: 129.0, location: "Busan" }),
    ]);
    expect(trips).toHaveLength(2);
  });

  it("keeps photos from different spots in the same city as one trip", () => {
    // Same day in Sokcho: the beach and the town, ~3 km apart.
    const sokcho = detectTrips([
      p("beach", "2026-06-03T03:00:00Z", { lat: 38.1906, lng: 128.6017, location: "Sokcho" }),
      p("town", "2026-06-03T06:00:00Z", { lat: 38.2070, lng: 128.5918, location: "Sokcho" }),
    ]);
    expect(sokcho).toHaveLength(1);
    // Two days across Seoul, ~11 km apart.
    const seoul = detectTrips([
      p("hongdae", "2026-09-29T10:00:00Z", { lat: 37.5563, lng: 126.9220 }),
      p("konkuk", "2026-09-30T10:00:00Z", { lat: 37.5404, lng: 127.0692 }),
    ]);
    expect(seoul).toHaveLength(1);
  });

  it("treats a 0 latitude/longitude as a real coordinate", () => {
    const trips = detectTrips([
      p("equator", "2026-01-01T00:00:00Z", { lat: 0, lng: 10, location: "Gabon" }),
      p("seoul", "2026-01-02T00:00:00Z"),
    ]);
    expect(trips.map((t) => t.name).sort()).toEqual(["Gabon", "Seoul"]);
  });
});

describe("tripKeyOf", () => {
  it("is independent of photo order", () => {
    const a = p("a", "2026-01-01T00:00:00Z"), b = p("b", "2026-01-01T00:00:00Z");
    const trip = (photos: MapPhoto[]) => ({ id: "", name: "", dateRange: "", photos, locations: [] });
    expect(tripKeyOf(trip([a, b]))).toBe(tripKeyOf(trip([b, a])));
  });
});
