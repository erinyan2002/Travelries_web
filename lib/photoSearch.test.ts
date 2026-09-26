import { describe, it, expect } from "vitest";
import { matchesQuery, describeQuery, personNamesByPhoto, tokenize } from "./photoSearch";
import type { FacePhoto, MapPhoto } from "./types";

const photo = (extra: Partial<MapPhoto> = {}): MapPhoto => ({
  id: "a", fileName: "IMG_1234.jpg", imageUrl: "",
  captureTimestamp: "2026-06-02T10:00:00", location: "Haeoreum-ro, Joyang-dong, Sokcho-si", ...extra,
});

describe("matchesQuery", () => {
  it("matches a place", () => {
    expect(matchesQuery(photo(), "sokcho")).toBe(true);
    expect(matchesQuery(photo(), "Paris")).toBe(false);
  });

  it("matches a person tagged in the photo", () => {
    expect(matchesQuery(photo(), "Minji", ["Minji Kim"])).toBe(true);
    expect(matchesQuery(photo(), "Minji")).toBe(false);
  });

  it("combines place and person, ignoring 'with'", () => {
    expect(matchesQuery(photo(), "Sokcho with Minji", ["Minji"])).toBe(true);
    expect(matchesQuery(photo(), "Sokcho with Jiho", ["Minji"])).toBe(false);
  });

  it("matches a month and year", () => {
    expect(matchesQuery(photo(), "June 2026")).toBe(true);
    expect(matchesQuery(photo(), "jun")).toBe(true);
    expect(matchesQuery(photo(), "July 2026")).toBe(false);
    expect(matchesQuery(photo(), "2025")).toBe(false);
    expect(matchesQuery(photo(), "6월")).toBe(true);
  });

  it("matches landmark names and descriptions", () => {
    const p = photo({ landmarkName: "Sokcho Expo Tower", landmarkDescription: "An observation tower by the beach" });
    expect(matchesQuery(p, "expo tower")).toBe(true);
    expect(matchesQuery(p, "beach")).toBe(true);
  });

  it("treats an empty query as matching everything", () => {
    expect(matchesQuery(photo(), "  with ")).toBe(true);
  });
});

describe("describeQuery", () => {
  it("labels each word", () => {
    expect(describeQuery("Sokcho with Minji June 2026", ["Minji"]).map((t) => t.kind))
      .toEqual(["place", "person", "month", "year"]);
  });
});

describe("personNamesByPhoto", () => {
  it("maps photos to the named people tagged in them", () => {
    const faces = [{ id: "a", personIds: ["p1", null, "p2"] }, { id: "b", personIds: [null] }] as FacePhoto[];
    const map = personNamesByPhoto(faces, [{ id: "p1", name: "Minji", createdAt: "" }, { id: "p2", name: "Jiho", createdAt: "" }]);
    expect(map.get("a")).toEqual(["Minji", "Jiho"]);
    expect(map.has("b")).toBe(false);
  });
});

it("tokenize drops stopwords", () => {
  expect(tokenize("Paris with Erin, June")).toEqual(["paris", "erin", "june"]);
});
