// Pure decoding for the SCRFD face detector (InsightFace det_10g, the same model
// the backend's buffalo_l runs). No onnxruntime/DOM dependency, so it's unit-testable.
// lib/scrfdDetector.ts runs the model in the browser and calls these.
//
// Mirrors insightface/model_zoo/scrfd.py: three feature maps (strides 8/16/32),
// two anchors per grid cell, box and keypoint outputs as distances from the
// anchor centre, scaled by the stride.

export type Box = { x: number; y: number; width: number; height: number };
export type ScrfdFace = { box: Box; score: number; kps: Array<[number, number]> };

export const SCRFD_STRIDES = [8, 16, 32] as const;
const NUM_ANCHORS = 2;
export const SCRFD_NMS_IOU = 0.4;

// The model's outputs in session order: scores for each stride, then boxes, then
// keypoints (9 arrays for det_10g). `scale` is input-pixels per original-pixel,
// so decoded boxes are mapped back to the original image.
export function decodeScrfd(
  outputs: ArrayLike<number>[],
  inputW: number,
  inputH: number,
  scale: number,
  threshold: number,
): ScrfdFace[] {
  const fmc = SCRFD_STRIDES.length;
  const faces: ScrfdFace[] = [];
  SCRFD_STRIDES.forEach((stride, idx) => {
    const scores = outputs[idx], boxes = outputs[idx + fmc], kps = outputs[idx + fmc * 2];
    const gw = Math.floor(inputW / stride), gh = Math.floor(inputH / stride);
    const n = gw * gh * NUM_ANCHORS;
    for (let i = 0; i < n; i++) {
      const score = scores[i];
      if (score < threshold) continue;
      const cell = Math.floor(i / NUM_ANCHORS);
      const cx = (cell % gw) * stride, cy = Math.floor(cell / gw) * stride;
      const x1 = cx - boxes[i * 4] * stride, y1 = cy - boxes[i * 4 + 1] * stride;
      const x2 = cx + boxes[i * 4 + 2] * stride, y2 = cy + boxes[i * 4 + 3] * stride;
      const points: Array<[number, number]> = [];
      if (kps) {
        for (let k = 0; k < 5; k++) {
          points.push([(cx + kps[i * 10 + k * 2] * stride) / scale, (cy + kps[i * 10 + k * 2 + 1] * stride) / scale]);
        }
      }
      faces.push({
        box: { x: x1 / scale, y: y1 / scale, width: (x2 - x1) / scale, height: (y2 - y1) / scale },
        score, kps: points,
      });
    }
  });
  return nmsFaces(faces, SCRFD_NMS_IOU);
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter === 0 ? 0 : inter / (a.width * a.height + b.width * b.height - inter);
}

export function nmsFaces<T extends { box: Box; score: number }>(faces: T[], thr: number): T[] {
  const kept: T[] = [];
  for (const f of [...faces].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => iou(k.box, f.box) < thr)) kept.push(f);
  }
  return kept;
}

// Which detections count as faces. SCRFD runs at SCRFD_DETECT_SCORE so that a
// weak duplicate is merged by NMS first; then a face needs SCRFD_MIN_SCORE (the
// backend's bar too). On 47 test photos the 0.33-0.5 boxes were half real faces
// (half hidden behind someone, a masked face at the back) and half food, the back
// of a head and dark seats, with no cutoff between them, so 0.5 stays.
// A weak-ish face that is also tiny next to the photo's biggest face is dropped
// (a far-background blur), like the backend's _filter_weak in face_utils.py.
export const SCRFD_DETECT_SCORE = 0.3;
export const SCRFD_MIN_SCORE = 0.5;
export const SCRFD_SMALL_SCORE = 0.6;
export const SCRFD_SMALL_AREA = 0.02;
// Eye-to-eye distance over box width: ~0.45 for a frontal face, ~0.06-0.2 for a
// side view, and under 0.05 when the head is turned away (the back of a head and
// an ear, a face hidden under a cap brim). Only faces someone can see are kept.
export const SCRFD_MIN_EYE_RATIO = 0.055;

export function eyeRatio(f: { box: Box; kps: Array<[number, number]> }): number {
  if (f.kps.length < 2 || f.box.width <= 0) return 1;
  return Math.hypot(f.kps[1][0] - f.kps[0][0], f.kps[1][1] - f.kps[0][1]) / f.box.width;
}

export function filterScrfdFaces<T extends { box: Box; score: number; kps: Array<[number, number]> }>(faces: T[]): T[] {
  const strong = faces.filter((f) => f.score >= SCRFD_MIN_SCORE && eyeRatio(f) >= SCRFD_MIN_EYE_RATIO);
  const maxArea = Math.max(0, ...strong.map((f) => f.box.width * f.box.height));
  return strong.filter((f) => f.score >= SCRFD_SMALL_SCORE
    || f.box.width * f.box.height >= maxArea * SCRFD_SMALL_AREA);
}
