import { describe, it, expect } from "vitest";
import { boxIoU, descriptorDistance, pickCropMatch, dedupeFaces } from "./faceMatching";

const box = (x: number, y: number, w = 100, h = 100) => ({ x, y, width: w, height: h });

describe("boxIoU", () => {
  it("is 1 for identical boxes and 0 for disjoint ones", () => {
    expect(boxIoU(box(0, 0), box(0, 0))).toBe(1);
    expect(boxIoU(box(0, 0), box(200, 0))).toBe(0);
  });
});

describe("descriptorDistance", () => {
  it("never compares descriptors of different lengths", () => {
    expect(descriptorDistance([0, 0], [0, 0, 0])).toBe(Infinity);
    expect(descriptorDistance([], [])).toBe(Infinity);
  });
});

describe("pickCropMatch", () => {
  // The two-person selfie bug: the woman's MediaPipe box (edge of frame) was
  // padded into a crop that also held the man's face, and face-api returned his.
  const womanMpBox = box(0, 150, 300, 400);
  const womanInCrop = { id: "woman", box: box(10, 170, 280, 380) };
  const manInCrop = { id: "man", box: box(360, 140, 300, 300) };

  it("picks the detection that overlaps this MediaPipe box, not the neighbour", () => {
    expect(pickCropMatch([manInCrop, womanInCrop], womanMpBox)?.id).toBe("woman");
  });

  it("rejects a crop whose only detection is the neighbour's face", () => {
    expect(pickCropMatch([manInCrop], womanMpBox)).toBeNull();
  });
});

describe("dedupeFaces", () => {
  const d = (v: number) => Array.from({ length: 128 }, () => v);

  it("drops the same face seen through two crops, keeping the higher score", () => {
    const a = { box: box(430, 140, 380, 360), score: 0.9, descriptor: d(0.1) };
    const b = { box: box(440, 165, 310, 340), score: 0.7, descriptor: d(0.101) };
    expect(dedupeFaces([b, a])).toEqual([a]);
  });

  it("drops a near-identical descriptor even when boxes barely overlap", () => {
    const a = { box: box(0, 0), score: 0.9, descriptor: d(0.1) };
    const b = { box: box(90, 90), score: 0.8, descriptor: d(0.1) };
    expect(dedupeFaces([a, b])).toHaveLength(1);
  });

  it("keeps two different people", () => {
    const a = { box: box(0, 0), score: 0.9, descriptor: d(0.1) };
    const b = { box: box(300, 0), score: 0.8, descriptor: d(0.2) };
    expect(dedupeFaces([a, b])).toHaveLength(2);
  });
});
