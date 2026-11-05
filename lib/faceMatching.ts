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

// Intersection over the SMALLER box's area — 1 when one box is fully inside the
// other. Plain IoU misses that case (a box inside one ~4x its size has IoU ~0.25),
// which let one face come out as two nested boxes.
export function containment(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const small = Math.min(a.width * a.height, b.width * b.height);
  return small > 0 ? inter / small : 0;
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
// crops gives descriptors ~0.1-0.3 apart, but so do different people: on 31 test
// photos, 30+ pairs of different people standing apart were 0.21-0.40 apart. So a
// close descriptor only merges boxes that also overlap (DEDUPE_DESC_OVERLAP).
export const DEDUPE_IOU = 0.4;
export const DEDUPE_DESC_DIST = 0.4;
export const DEDUPE_DESC_OVERLAP = 0.3;
// A box this much inside another is the same face (two people's faces never nest).
export const DEDUPE_CONTAIN = 0.6;

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

// face-api's SSD detector, run on the whole photo, is the second opinion for
// faces MediaPipe + the tiny crop check lose. On a 6-person group photo it found
// all six, including a selfie face cut off at the frame edge (MediaPipe 0.49, so
// below RETRY_MIN_MP_SCORE and dropped) and a face turned to the side that
// MediaPipe never localized.
export const SSD_AGREE_SCORE = 0.45;
export const SSD_ONLY_SCORE = 0.45;

function overlaps(a: Box, b: Box): boolean {
  return boxIoU(a, b) >= CROP_MATCH_IOU || containment(a, b) >= DEDUPE_CONTAIN;
}

// A MediaPipe box face-api couldn't confirm still counts when SSD independently
// found a face in the same place: two detectors agreeing. MediaPipe's false boxes
// (food, a cake, the back of a head) had no such second opinion.
export function pickSsdAgreement<T extends ScoredFace>(ssd: T[], mpBox: Box): T | null {
  let best: T | null = null;
  for (const f of ssd) {
    if (f.score >= SSD_AGREE_SCORE && overlaps(f.box, mpBox) && (!best || f.score > best.score)) best = f;
  }
  return best;
}

// The permissive retry pass (score 0.01) also "confirms" non-faces when MediaPipe
// was fairly sure: on 31 test photos its 3 false boxes (the back of a head, a body,
// food) had no SSD detection at all, while all 10 real faces it rescued had one
// (SSD ≥ 0.42). So a retry-only match needs SSD to see a face there too.
export function ssdSupports(ssd: { box: Box }[], box: Box): boolean {
  return ssd.some((f) => overlaps(f.box, box));
}

// An SSD face already this much under a kept box is the same face with an offset
// box, not a face MediaPipe missed (a group photo got two boxes on one man at
// 0.48; the closest real neighbour was 0.40).
export const SSD_ONLY_COVERED = 0.45;

// SSD faces that nothing kept so far covers: faces MediaPipe never localized.
export function ssdOnlyFaces<T extends ScoredFace>(ssd: T[], kept: { box: Box }[]): T[] {
  return ssd.filter((f) => f.score >= SSD_ONLY_SCORE
    && !kept.some((k) => overlaps(f.box, k.box) || containment(f.box, k.box) >= SSD_ONLY_COVERED));
}

// A close descriptor used to also merge boxes that didn't overlap at all: two
// faces side by side, or two large faces anywhere (meant for one couple repeated
// in photo-booth frames). That deleted real people, e.g. the biggest face in a
// 6-friend selfie (0.34 from the friend next to her). Keeping a repeated
// photo-booth face is the safer mistake: the user can untick it before saving.
function sameFace(a: ScoredFace, b: ScoredFace): boolean {
  const contain = containment(a.box, b.box);
  if (boxIoU(a.box, b.box) >= DEDUPE_IOU || contain >= DEDUPE_CONTAIN) return true;
  return contain >= DEDUPE_DESC_OVERLAP && descriptorDistance(a.descriptor, b.descriptor) < DEDUPE_DESC_DIST;
}

// Drops any face that overlaps, sits inside, or overlaps with a near-identical
// descriptor a face already kept. Between a nested pair the LARGER box wins (the
// smaller is usually a partial face); otherwise the higher score wins.
export function dedupeFaces<T extends ScoredFace>(faces: T[]): T[] {
  const kept: T[] = [];
  for (const c of [...faces].sort((a, b) => b.score - a.score)) {
    const i = kept.findIndex((k) => sameFace(c, k));
    if (i === -1) kept.push(c);
    else if (containment(c.box, kept[i].box) >= DEDUPE_CONTAIN
             && c.box.width * c.box.height > kept[i].box.width * kept[i].box.height) kept[i] = c;
  }
  return kept;
}

// For already-saved photos: indices of faces that sit inside another face box
// on the same photo (the smaller of each nested pair). Skips removed faces
// (zero-size tombstones) and any face the user has manually tagged.
export function nestedDuplicateIndices(boxes: Box[], personIds?: (string | null)[]): number[] {
  const live = boxes.map((b, i) => ({ b, i })).filter(({ b }) => b.width > 0 && b.height > 0);
  const drop = new Set<number>();
  for (const a of live) {
    for (const o of live) {
      if (a.i === o.i || drop.has(o.i)) continue;
      const aSmaller = a.b.width * a.b.height < o.b.width * o.b.height
        || (a.b.width * a.b.height === o.b.width * o.b.height && a.i > o.i);
      if (aSmaller && containment(a.b, o.b) >= DEDUPE_CONTAIN && !personIds?.[a.i]) drop.add(a.i);
    }
  }
  return [...drop];
}
