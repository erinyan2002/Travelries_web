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
// crops gives descriptors ~0.1-0.3 apart; two different people in one photo are
// essentially never under 0.4 (face-api's own same-person threshold is 0.6).
export const DEDUPE_IOU = 0.4;
export const DEDUPE_DESC_DIST = 0.4;
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

// SSD faces that nothing kept so far covers: faces MediaPipe never localized.
export function ssdOnlyFaces<T extends ScoredFace>(ssd: T[], kept: { box: Box }[]): T[] {
  return ssd.filter((f) => f.score >= SSD_ONLY_SCORE && !kept.some((k) => overlaps(f.box, k.box)));
}

// A near-identical descriptor alone only merges two boxes that sit close together
// (centres within 1.5 face widths) or two LARGE faces (each ≥ 12% of the photo's
// width, e.g. the same couple in four photo-booth frames). Small faces in a group
// photo have weak descriptors, and two different people far apart in the row
// could fall under 0.4 and be merged into one, dropping a person.
export const DEDUPE_NEAR = 1.5;
export const LARGE_FACE_SHARE = 0.12;

function near(a: Box, b: Box): boolean {
  const dx = (a.x + a.width / 2) - (b.x + b.width / 2), dy = (a.y + a.height / 2) - (b.y + b.height / 2);
  return Math.hypot(dx, dy) <= DEDUPE_NEAR * Math.max(a.width, b.width);
}

function sameFace(a: ScoredFace, b: ScoredFace, imageWidth?: number): boolean {
  if (boxIoU(a.box, b.box) >= DEDUPE_IOU || containment(a.box, b.box) >= DEDUPE_CONTAIN) return true;
  const large = imageWidth !== undefined
    && Math.min(a.box.width, b.box.width) >= LARGE_FACE_SHARE * imageWidth;
  return (large || near(a.box, b.box)) && descriptorDistance(a.descriptor, b.descriptor) < DEDUPE_DESC_DIST;
}

// Drops any face that overlaps, sits inside, or is a near-identical descriptor
// match of a face already kept — one person can't appear twice in a photo.
// Between a nested pair the LARGER box wins (the smaller is usually a partial
// face); otherwise the higher score wins.
export function dedupeFaces<T extends ScoredFace>(faces: T[], imageWidth?: number): T[] {
  const kept: T[] = [];
  for (const c of [...faces].sort((a, b) => b.score - a.score)) {
    const i = kept.findIndex((k) => sameFace(c, k, imageWidth));
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
