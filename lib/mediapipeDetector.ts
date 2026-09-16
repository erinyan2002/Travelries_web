import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

// Two BlazeFace variants, run together and merged — neither one alone covers the
// full range of real photos:
//   • full_range: tuned for faces farther from the camera / smaller in frame —
//     needed for group photos, but its anchor priors miss a face that fills most
//     of the frame (a close-up selfie), sometimes locking onto a random small
//     patch elsewhere in the image instead.
//   • short_range: tuned for exactly that close-up case, but misses small/far
//     faces in a group shot.
// Running both and merging via NMS (below) gets the strengths of each without
// having to guess which model a given photo needs.
let fullDetectorPromise: Promise<FaceDetector> | null = null;
let shortDetectorPromise: Promise<FaceDetector> | null = null;

function createDetector(modelAssetPath: string): Promise<FaceDetector> {
  return FilesetResolver.forVisionTasks("/mediapipe-wasm").then((vision) =>
    FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath },
      runningMode: "IMAGE",
      // 0.3 caused false positives (shadows/limbs mistaken for faces, esp. at
      // night); 0.4 is the accuracy/recall sweet spot for both models.
      minDetectionConfidence: 0.4,
    })
  );
}

function loadFullRangeDetector(): Promise<FaceDetector> {
  if (!fullDetectorPromise) fullDetectorPromise = createDetector("/models/mediapipe/blaze_face_full_range.tflite");
  return fullDetectorPromise;
}

function loadShortRangeDetector(): Promise<FaceDetector> {
  if (!shortDetectorPromise) shortDetectorPromise = createDetector("/models/mediapipe/blaze_face_short_range.tflite");
  return shortDetectorPromise;
}

// Kept for callers that only need to know MediaPipe is usable at all (app/page.tsx's
// startup model-load Promise.all) — resolves once both detectors are ready.
export function loadMediaPipeDetector(): Promise<[FaceDetector, FaceDetector]> {
  return Promise.all([loadFullRangeDetector(), loadShortRangeDetector()]);
}

type RawDetection = { x: number; y: number; width: number; height: number; score: number };

// full_range's own input is a small fixed square (well under 300px) — feeding it a
// whole multi-megapixel group photo downscales it so much that anyone smaller/farther
// from the camera shrinks past what the model can pick up. Tiling (same idea as the
// backend's SCRFD tiling in face_utils.py, just at a much smaller tile size to match
// this much lighter model) runs detection on overlapping crops instead, so each face
// is seen at a reasonable resolution regardless of how big the source photo is.
const TILE_SIZE   = 800;   // px — detector input per tile
const TILE_STRIDE = 650;   // px — step between tiles (150px overlap on each side)
const NMS_IOU_THR = 0.4;   // IoU threshold for duplicate suppression across tiles/models

function tileStarts(total: number, size: number, stride: number): number[] {
  if (total <= size) return [0];
  const starts: number[] = [];
  for (let s = 0; s + size <= total; s += stride) starts.push(s);
  starts.push(total - size); // last tile always reaches the far edge
  return [...new Set(starts)].sort((a, b) => a - b);
}

function iou(a: RawDetection, b: RawDetection): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  return inter / (a.width * a.height + b.width * b.height - inter);
}

function nms(dets: RawDetection[], iouThr: number): RawDetection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const kept: RawDetection[] = [];
  for (const d of sorted) {
    if (kept.every((k) => iou(d, k) < iouThr)) kept.push(d);
  }
  return kept;
}

function detectionsFrom(
  result: ReturnType<FaceDetector["detect"]>, offsetX: number, offsetY: number,
): RawDetection[] {
  return result.detections
    .filter((d): d is typeof d & { boundingBox: NonNullable<typeof d.boundingBox> } => !!d.boundingBox)
    .map((d) => ({
      x: d.boundingBox.originX + offsetX,
      y: d.boundingBox.originY + offsetY,
      width: d.boundingBox.width,
      height: d.boundingBox.height,
      score: d.categories[0]?.score ?? 1,
    }));
}

export async function detectFacesMediaPipe(imgEl: HTMLImageElement): Promise<RawDetection[]> {
  const [fullDetector, shortDetector] = await Promise.all([loadFullRangeDetector(), loadShortRangeDetector()]);
  const W = imgEl.naturalWidth, H = imgEl.naturalHeight;

  // full_range, whole-image pass — the safety net for faces that are large
  // relative to a tile (extreme close-ups) or straddle a tile seam, either of
  // which a tile-only pass can miss entirely even though the untiled image
  // shows the face just fine.
  const all: RawDetection[] = detectionsFrom(fullDetector.detect(imgEl), 0, 0);

  if (Math.max(W, H) > TILE_SIZE) {
    // full_range, tiled — ADDS recall for small/far faces in large group photos,
    // merged with the whole-image pass above via NMS, never replacing it.
    const xs = tileStarts(W, TILE_SIZE, TILE_STRIDE);
    const ys = tileStarts(H, TILE_SIZE, TILE_STRIDE);
    const canvas = document.createElement("canvas");
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext("2d")!;

    for (const ty of ys) {
      for (const tx of xs) {
        const tw = Math.min(TILE_SIZE, W - tx), th = Math.min(TILE_SIZE, H - ty);
        ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
        ctx.drawImage(imgEl, tx, ty, tw, th, 0, 0, tw, th);
        all.push(...detectionsFrom(fullDetector.detect(canvas), tx, ty));
      }
    }
  }

  // short_range, whole-image pass — catches a face that fills most of the frame
  // (close-up selfie), which full_range's own anchors are prone to miss entirely.
  all.push(...detectionsFrom(shortDetector.detect(imgEl), 0, 0));

  return nms(all, NMS_IOU_THR);
}
