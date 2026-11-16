import { describe, it, expect } from "vitest";
import { decodeScrfd, filterScrfdFaces, nmsFaces, eyeRatio, SCRFD_STRIDES } from "./scrfd";

// Builds empty det_10g-shaped outputs for a square input, then lets a test set
// one anchor's score, box distances and keypoints.
function emptyOutputs(size: number) {
  const n = SCRFD_STRIDES.map((s) => (size / s) ** 2 * 2);
  return [
    ...n.map((k) => new Float32Array(k)),
    ...n.map((k) => new Float32Array(k * 4)),
    ...n.map((k) => new Float32Array(k * 10)),
  ];
}

const frontalKps = (x: number, y: number, w: number): Array<[number, number]> => [
  [x + w * 0.3, y + w * 0.4], [x + w * 0.75, y + w * 0.4], [x + w * 0.5, y + w * 0.6],
  [x + w * 0.35, y + w * 0.8], [x + w * 0.65, y + w * 0.8],
];

describe("decodeScrfd", () => {
  it("decodes an anchor's distances into a box and keypoints in original pixels", () => {
    const size = 64;
    const out = emptyOutputs(size);
    // stride 8 → 8x8 grid, 2 anchors per cell. Cell (x=3, y=2) = index 19, 2nd anchor → 39.
    const i = (2 * 8 + 3) * 2 + 1;
    out[0][i] = 0.9;
    out[3].set([1, 1, 2, 3], i * 4);           // left, top, right, bottom in strides
    out[6].set([0, 0, 1, 0, 0, 1, 1, 1, -1, -1], i * 10);
    const faces = decodeScrfd(out, size, size, 0.5, 0.3); // input is half the original size
    expect(faces).toHaveLength(1);
    const f = faces[0];
    // centre (24, 16): box (16, 8)-(40, 40) in input px, then / 0.5
    expect(f.box).toEqual({ x: 32, y: 16, width: 48, height: 64 });
    expect(f.score).toBeCloseTo(0.9);
    expect(f.kps[0]).toEqual([48, 32]);
    expect(f.kps[1]).toEqual([64, 32]);
    expect(f.kps[4]).toEqual([32, 16]);
  });

  it("drops anchors under the threshold and merges overlapping ones", () => {
    const size = 64;
    const out = emptyOutputs(size);
    const a = (2 * 8 + 3) * 2, b = a + 1, c = (6 * 8 + 6) * 2;
    out[0][a] = 0.8; out[3].set([2, 2, 2, 2], a * 4);
    out[0][b] = 0.7; out[3].set([2, 2, 2, 2], b * 4);  // same box → merged by NMS
    out[0][c] = 0.2; out[3].set([1, 1, 1, 1], c * 4);  // under threshold
    const faces = decodeScrfd(out, size, size, 1, 0.3);
    expect(faces.map((f) => +f.score.toFixed(2))).toEqual([0.8]);
  });
});

describe("nmsFaces", () => {
  it("keeps the higher score of two overlapping boxes and both of two apart", () => {
    const box = (x: number) => ({ x, y: 0, width: 10, height: 10 });
    const kept = nmsFaces([{ box: box(0), score: 0.6 }, { box: box(1), score: 0.9 }, { box: box(50), score: 0.5 }], 0.4);
    expect(kept.map((k) => k.score)).toEqual([0.9, 0.5]);
  });
});

describe("filterScrfdFaces", () => {
  const face = (x: number, w: number, score: number, kps = frontalKps(x, 0, w)) =>
    ({ box: { x, y: 0, width: w, height: w * 1.2 }, score, kps });

  it("keeps faces at 0.5 and over, drops weaker ones", () => {
    const kept = filterScrfdFaces([face(0, 100, 0.9), face(200, 100, 0.5), face(400, 100, 0.49)]);
    expect(kept.map((f) => f.score)).toEqual([0.9, 0.5]);
  });

  it("drops a weak face that is tiny next to the biggest one, keeps a strong tiny one", () => {
    const kept = filterScrfdFaces([face(0, 300, 0.9), face(400, 30, 0.55), face(500, 30, 0.8)]);
    expect(kept.map((f) => f.score)).toEqual([0.9, 0.8]);
  });

  it("drops a head turned away (eyes almost on top of each other), keeps a side view", () => {
    const x = 0, w = 100;
    const turnedAway: Array<[number, number]> = [[50, 40], [53, 40], [60, 60], [50, 80], [55, 80]];
    const sideView: Array<[number, number]> = [[40, 40], [52, 40], [70, 60], [45, 80], [55, 80]];
    expect(eyeRatio(face(x, w, 0.8, turnedAway))).toBeLessThan(0.055);
    expect(eyeRatio(face(x, w, 0.8, sideView))).toBeGreaterThan(0.055);
    const kept = filterScrfdFaces([face(x, w, 0.8, turnedAway), face(200, w, 0.7, sideView)]);
    expect(kept.map((f) => f.score)).toEqual([0.7]);
  });
});
