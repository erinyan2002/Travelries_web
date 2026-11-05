import { describe, it, expect } from "vitest";
import { summarizeTrip, placeLabel, cityOf, tripAnchorId, formatTripDates, formatDistance } from "./tripMemory";
import type { Trip } from "./trips";
import type { MapPhoto } from "./types";

const p = (id: string, iso: string, location: string, extra: Partial<MapPhoto> = {}): MapPhoto =>
  ({ id, fileName: `${id}.jpg`, imageUrl: "", captureTimestamp: iso, location, lat: 38.2, lng: 128.6, ...extra });

const trip = (photos: MapPhoto[]): Trip => ({ id: "trip-0", name: "Haeoreum-ro", dateRange: "", photos, locations: [] });

describe("placeLabel / cityOf", () => {
  it("uses the neighbourhood, not the road, and the last part as the city", () => {
    const photo = p("a", "2026-06-02T10:00:00", "Haeoreum-ro, Joyang-dong, Sokcho-si");
    expect(placeLabel(photo)).toBe("Joyang-dong");
    expect(cityOf(photo)).toBe("Sokcho-si");
  });

  it("reads the backend's Nominatim address (province, postcode, country dropped)", () => {
    const photo = p("a", "2026-09-16T10:00:00", "Bukhangang-ro, Yangsu-ri, Yangpyeong-gun, Gyeonggi, 12280, South Korea");
    expect(cityOf(photo)).toBe("Yangpyeong-gun");
    expect(placeLabel(photo)).toBe("Yangsu-ri");
    const sokcho = p("b", "2026-09-16T10:00:00", "Cheongho-dong, Sokcho-si, Gangwon State, 24886, South Korea");
    expect(cityOf(sokcho)).toBe("Sokcho-si");
    expect(placeLabel(sokcho)).toBe("Cheongho-dong");
    expect(summarizeTrip(trip([photo])).title).toBe("Yangpyeong Trip");
  });

  it("prefers a recognized landmark", () => {
    expect(placeLabel(p("a", "2026-06-02T10:00:00", "Road, Dong, City", { landmarkName: "Eiffel Tower" }))).toBe("Eiffel Tower");
  });

  it("ignores a coordinate-only fallback location", () => {
    const photo = p("a", "2026-06-02T10:00:00", "37.123456, 127.123456");
    expect(placeLabel(photo)).toBeNull();
    expect(cityOf(photo)).toBeNull();
  });
});

describe("summarizeTrip", () => {
  const photos = [
    p("c", "2026-06-03T09:00:00", "R, Seorak-dong, Sokcho-si", { lat: 38.17, lng: 128.49 }),
    p("a", "2026-06-02T10:00:00", "R, Joyang-dong, Sokcho-si", { lat: 38.19, lng: 128.60 }),
    p("b", "2026-06-02T12:00:00", "R, Joyang-dong, Sokcho-si", { lat: 38.19, lng: 128.60 }),
    p("d", "2026-06-02T18:00:00", "R, Cheongho-dong, Sokcho-si", { lat: 38.20, lng: 128.59 }),
  ];
  const m = summarizeTrip(trip(photos));

  it("titles the trip after its most common city", () => {
    expect(m.title).toBe("Sokcho Trip");
  });

  it("builds day-by-day stops, merging consecutive photos at one place", () => {
    expect(m.days.map((d) => d.day)).toEqual([1, 2]);
    expect(m.days[0].stops.map((s) => s.place)).toEqual(["Joyang-dong", "Cheongho-dong"]);
    expect(m.days[0].stops[0].photoIds).toEqual(["a", "b"]);
    expect(m.journey).toEqual(["Joyang-dong", "Cheongho-dong", "Seorak-dong"]);
  });

  it("counts places, the most visited one, and the distance along the route", () => {
    expect(m.places).toHaveLength(3);
    expect(m.mostVisited).toEqual({ place: "Joyang-dong", photos: 2 });
    expect(m.route).toHaveLength(4);
    expect(m.distanceKm).toBeGreaterThan(10);
    expect(m.dayCount).toBe(2);
  });

  it("anchors the trip on its earliest photo", () => {
    expect(tripAnchorId(trip(photos))).toBe("a");
  });

  it("numbers days by calendar distance, leaving gaps", () => {
    const gap = summarizeTrip(trip([p("a", "2026-06-02T10:00:00", "X"), p("b", "2026-06-04T10:00:00", "Y")]));
    expect(gap.days.map((d) => d.day)).toEqual([1, 3]);
    expect(gap.dayCount).toBe(3);
  });
});

describe("formatting", () => {
  it("formats date ranges", () => {
    expect(formatTripDates(new Date(2026, 5, 2), new Date(2026, 5, 7))).toBe("Jun 2 – Jun 7, 2026");
    expect(formatTripDates(new Date(2026, 5, 2, 9), new Date(2026, 5, 2, 20))).toBe("Jun 2, 2026");
    expect(formatTripDates(new Date(2025, 11, 30), new Date(2026, 0, 2))).toBe("Dec 30, 2025 – Jan 2, 2026");
  });

  it("formats distances", () => {
    expect(formatDistance(0)).toBe("—");
    expect(formatDistance(0.42)).toBe("420 m");
    expect(formatDistance(3.456)).toBe("3.5 km");
    expect(formatDistance(37.4)).toBe("37 km");
  });
});
