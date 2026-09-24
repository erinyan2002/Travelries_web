// Pure box/descriptor matching used by browser-mode face detection
// (lib/faceDetection.ts). No face-api/DOM dependency, so it's unit-testable.

type Box = { x: number; y: number; width: number; height: number };
export type ScoredFace = { box: Box; score: number; descriptor: number[] };

export function boxIoU(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  return inter / (a.width * a.height + b.width * b.height - inter);
}

export function descriptorDistance(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

// A face-api detection inside a MediaPipe crop must overlap that MediaPipe box
// at least this much to count as confirming it (rather than being a neighbour's
// face that also fell inside the padded crop).
export const CROP_MATCH_IOU = 0.3;
// Final same-face dedupe. The same face seen through two slightly different
// crops gives descriptors ~0.1-0.3 apart; two different people in one photo are
// essentially never under 0.4 (face-api's own same-person threshold is 0.6).
export const DEDUPE_IOU = 0.4;
export const DEDUPE_DESC_DIST = 0.4;

// Picks the face-api detection (from inside a padded crop) that confirms THIS
// MediaPipe box, or null. The crop can also contain a neighbour's face; taking
// the crop's top-scoring face instead double-counted that neighbour and lost
// the person the box was actually for.
export function pickCropMatch<T extends { box: Box }>(candidates: T[], mpBox: Box): T | null {
  let best: T | null = null, bestIoU = CROP_MATCH_IOU;
  for (const c of candidates) {
    const ov = boxIoU(c.box, mpBox);
    if (ov >= bestIoU) { best = c; bestIoU = ov; }
  }
  return best;
}

// Drops any face that overlaps, or is a near-identical descriptor match of, a
// higher-scoring face already kept — one person can't appear twice in a photo.
export function dedupeFaces<T extends ScoredFace>(faces: T[]): T[] {
  const kept: T[] = [];
  for (const c of [...faces].sort((a, b) => b.score - a.score)) {
    const dup = kept.some((k) =>
      boxIoU(c.box, k.box) >= DEDUPE_IOU || descriptorDistance(c.descriptor, k.descriptor) < DEDUPE_DESC_DIST);
    if (!dup) kept.push(c);
  }
  return kept;
}
