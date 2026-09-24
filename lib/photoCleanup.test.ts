import { describe, it, expect } from "vitest";
import {
  toGrayscale, dHash, hammingDistance, laplacianVariance, groupSimilar, findBlurry,
  DHASH_W, DHASH_H, AnalyzedPhoto,
} from "./photoCleanup";

const gradient = (dir: 1 | -1) =>
  Array.from({ length: DHASH_W * DHASH_H }, (_, i) => 128 + dir * ((i % DHASH_W) * 10));

describe("toGrayscale", () => {
  it("weights RGB into luminance", () => {
    expect(Array.from(toGrayscale([255, 255, 255, 255, 0, 0, 0, 255], 2, 1)).map(Math.round)).toEqual([255, 0]);
  });
});

describe("dHash / hammingDistance", () => {
  it("is identical for the same image and maximally different for its mirror", () => {
    expect(hammingDistance(dHash(gradient(1)), dHash(gradient(1)))).toBe(0);
    expect(hammingDistance(dHash(gradient(1)), dHash(gradient(-1)))).toBe(64);
  });
});

describe("laplacianVariance", () => {
  it("is 0 for a flat image and high for sharp edges", () => {
    const flat = new Array(16 * 16).fill(100);
    const checker = Array.from({ length: 16 * 16 }, (_, i) => ((i % 16) + Math.floor(i / 16)) % 2 ? 255 : 0);
    expect(laplacianVariance(flat, 16, 16)).toBe(0);
    expect(laplacianVariance(checker, 16, 16)).toBeGreaterThan(1000);
  });
});

const hashWith = (flips: number) => "1".repeat(flips) + "0".repeat(64 - flips);
const photo = (id: string, hash: string, takenAt: number | null, sharpness = 100): AnalyzedPhoto =>
  ({ id, hash, takenAt, sharpness });

describe("groupSimilar", () => {
  const t = Date.UTC(2026, 0, 1);

  it("groups near-identical shots taken close together, sharpest first", () => {
    const groups = groupSimilar([
      photo("a", hashWith(0), t, 50), photo("b", hashWith(3), t + 5_000, 200), photo("c", hashWith(40), t),
    ]);
    expect(groups.map((g) => g.map((p) => p.id))).toEqual([["b", "a"]]);
  });

  it("does not group look-alikes taken hours apart", () => {
    expect(groupSimilar([photo("a", hashWith(0), t), photo("b", hashWith(2), t + 3 * 3600_000)])).toEqual([]);
  });

  it("uses a stricter hash match when capture time is unknown", () => {
    expect(groupSimilar([photo("a", hashWith(0), null), photo("b", hashWith(8), null)])).toEqual([]);
    expect(groupSimilar([photo("a", hashWith(0), null), photo("b", hashWith(4), null)])).toHaveLength(1);
  });
});

describe("findBlurry", () => {
  it("returns photos below the threshold, blurriest first", () => {
    const res = findBlurry([photo("a", "", null, 10), photo("b", "", null, 500), photo("c", "", null, 5)], 60);
    expect(res.map((p) => p.id)).toEqual(["c", "a"]);
  });
});
