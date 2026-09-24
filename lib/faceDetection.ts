// Browser-mode face detection for the Home page upload flow — MediaPipe BlazeFace
// localization + face-api.js confirmation/recognition, with SSD / TinyFaceDetector
// fallbacks. See the "Face detection" section of CLAUDE.md.
import * as faceapi from "face-api.js";
import { detectFacesMediaPipe } from "./mediapipeDetector";

export type DetectionResult = {
  count:       number;
  boxes:       Array<{ x: number; y: number; width: number; height: number }>;
  descriptors: number[][];
  confidences: number[];
  ages:        number[];
  genders:     string[];
  expressions: string[];
};

function boxIoU(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  return inter / (a.width * a.height + b.width * b.height - inter);
}

function descriptorDistance(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

// A face-api detection inside a MediaPipe crop must overlap that MediaPipe box
// at least this much to count as confirming it (rather than being a neighbour's
// face that also fell inside the padded crop).
const CROP_MATCH_IOU = 0.3;
// Final same-face dedupe. The same face seen through two slightly different
// crops gives descriptors ~0.1-0.3 apart; two different people in one photo are
// essentially never under 0.4 (face-api's own same-person threshold is 0.6).
const DEDUPE_IOU = 0.4;
const DEDUPE_DESC_DIST = 0.4;

export async function runFaceDetection(
  imgEl: HTMLImageElement,
  modelType: "mediapipe" | "ssd" | "tiny",
  hasExtra: boolean,
): Promise<DetectionResult> {
  const MIN_PX = 20;
  const W = imgEl.naturalWidth, H = imgEl.naturalHeight;
  const normBox = (b: { x: number; y: number; width: number; height: number }) =>
    ({ x: b.x / W, y: b.y / H, width: b.width / W, height: b.height / H });

  if (modelType === "mediapipe") {
    const mpBoxes = await detectFacesMediaPipe(imgEl);
    const rawBoxes = mpBoxes.filter((b) => b.width >= MIN_PX && b.height >= MIN_PX);
    if (rawBoxes.length === 0) {
      // Nothing to blame on the face-api confirmation step below — MediaPipe's
      // full_range/short_range/tiled passes themselves found no face (or found
      // only sub-MIN_PX boxes). Logged so a missed face can be told apart from
      // the "MediaPipe found it, face-api couldn't confirm it" case further down.
      console.warn(`No face localized by MediaPipe (${mpBoxes.length} raw box(es) before the ${MIN_PX}px size filter).`);
    }

    type Confirmed = {
      box: { x: number; y: number; width: number; height: number }; // full-image px
      score: number;
      descriptor: number[];
      age?: number;
      gender?: string;
      expression?: string;
    };
    const confirmed: Confirmed[] = [];

    for (const box of rawBoxes) {
      // Pad the MediaPipe box ~30% on each side, clamped to image bounds, so
      // face-api's landmark/recognition nets get enough context to align the face.
      const padX = box.width * 0.3, padY = box.height * 0.3;
      const cropX = Math.max(0, box.x - padX);
      const cropY = Math.max(0, box.y - padY);
      const cropW = Math.min(W, box.x + box.width + padX) - cropX;
      const cropH = Math.min(H, box.y + box.height + padY) - cropY;

      const canvas = document.createElement("canvas");
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(imgEl, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      // face-api's own box within this crop is a landmark-based detection, more
      // precise than MediaPipe's original box — use IT for the stored/displayed
      // position (translated back to full-image coordinates), not MediaPipe's.
      // Using MediaPipe's box unconditionally here was the actual cause of boxes
      // rendering on a collar/shoulder next to a confirmed face.
      const toFullImageBox = (b: { x: number; y: number; width: number; height: number }) =>
        ({ x: cropX + b.x, y: cropY + b.y, width: b.width, height: b.height });

      const tinyOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.1 });
      // A second, more permissive pass for a crop the first pass missed (tight
      // angle, glasses glare, an occluded chin/mouth) — MediaPipe already cleared
      // its own 0.4 confidence bar on the whole/tiled image, so a miss here is
      // face-api's landmark model choking on this specific crop, not "no face."
      const retryOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.01 });

      const detectInCrop = async (opts: faceapi.TinyFaceDetectorOptions): Promise<Confirmed[]> => {
        if (hasExtra) {
          const recs = await faceapi.detectAllFaces(canvas, opts)
            .withFaceLandmarks().withFaceDescriptors().withAgeAndGender().withFaceExpressions();
          return recs.map((r) => {
            const e = r.expressions as unknown as Record<string, number>;
            return {
              box: toFullImageBox(r.detection.box), score: r.detection.score,
              descriptor: Array.from(r.descriptor), age: Math.round(r.age), gender: r.gender,
              expression: Object.entries(e).sort((a, b) => b[1] - a[1])[0][0],
            };
          });
        }
        const recs = await faceapi.detectAllFaces(canvas, opts).withFaceLandmarks().withFaceDescriptors();
        return recs.map((r) => ({
          box: toFullImageBox(r.detection.box), score: r.detection.score, descriptor: Array.from(r.descriptor),
        }));
      };

      // The padded crop often also contains part of a NEIGHBOURING face (a
      // close-up face at the frame edge next to someone else). The old
      // detectSingleFace just took the crop's highest-scoring face — which was
      // the neighbour's fully-visible face, not this box's partially-cut one —
      // so the neighbour got counted twice and this person vanished. Only accept
      // the face-api detection that actually overlaps THIS MediaPipe box.
      const pickMatch = (cands: Confirmed[]): Confirmed | null => {
        let best: Confirmed | null = null, bestIoU = CROP_MATCH_IOU;
        for (const c of cands) {
          const ov = boxIoU(c.box, box);
          if (ov >= bestIoU) { best = c; bestIoU = ov; }
        }
        return best;
      };

      const match = pickMatch(await detectInCrop(tinyOpts)) ?? pickMatch(await detectInCrop(retryOpts));
      if (!match) {
        // face-api found no face matching this box even on the permissive retry —
        // treat that as MediaPipe having localized non-face content (its own
        // documented failure mode: "lock onto a random small patch"), not a
        // hard-but-real face. Discarding it, not keeping it, is what avoids a
        // wrong box landing on a collar/shadow/limb — verified against a real
        // false-positive case, see the reverted "keep unconfirmed box" attempt.
        console.warn("MediaPipe box rejected by face-api on both passes — discarded as a likely false positive.", box);
        continue;
      }
      confirmed.push(match);
    }

    // Safety net: two different MediaPipe boxes can still resolve to the same
    // real face (overlapping crops). One person can't appear twice in one photo,
    // so drop any face that overlaps or is a near-identical descriptor match of a
    // higher-scoring one already kept.
    const kept: Confirmed[] = [];
    for (const c of [...confirmed].sort((a, b) => b.score - a.score)) {
      const dup = kept.some((k) =>
        boxIoU(c.box, k.box) >= DEDUPE_IOU || descriptorDistance(c.descriptor, k.descriptor) < DEDUPE_DESC_DIST);
      if (!dup) kept.push(c);
    }
    kept.sort((a, b) => a.box.x - b.box.x); // stable left-to-right numbering

    return {
      count:       kept.length,
      boxes:       kept.map((k) => normBox(k.box)),
      descriptors: kept.map((k) => k.descriptor),
      confidences: kept.map((k) => k.score),
      ages:        hasExtra ? kept.map((k) => k.age!) : [],
      genders:     hasExtra ? kept.map((k) => k.gender!) : [],
      expressions: hasExtra ? kept.map((k) => k.expression!) : [],
    };
  }

  if (modelType === "ssd") {
    const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
    if (hasExtra) {
      const all = await faceapi
        .detectAllFaces(imgEl, opts)
        .withFaceLandmarks()
        .withFaceDescriptors()
        .withAgeAndGender()
        .withFaceExpressions();
      const f = all.filter((d) => d.detection.box.width >= MIN_PX && d.detection.box.height >= MIN_PX);
      return {
        count:       f.length,
        boxes:       f.map((d) => normBox(d.detection.box)),
        descriptors: f.map((d) => Array.from(d.descriptor)),
        confidences: f.map((d) => d.detection.score),
        ages:        f.map((d) => Math.round(d.age)),
        genders:     f.map((d) => d.gender),
        expressions: f.map((d) => {
          const e = d.expressions as unknown as Record<string, number>;
          return Object.entries(e).sort((a, b) => b[1] - a[1])[0][0];
        }),
      };
    }
    const all = await faceapi
      .detectAllFaces(imgEl, opts)
      .withFaceLandmarks()
      .withFaceDescriptors();
    const f = all.filter((d) => d.detection.box.width >= MIN_PX && d.detection.box.height >= MIN_PX);
    return {
      count:       f.length,
      boxes:       f.map((d) => normBox(d.detection.box)),
      descriptors: f.map((d) => Array.from(d.descriptor)),
      confidences: f.map((d) => d.detection.score),
      ages: [], genders: [], expressions: [],
    };
  }

  // TinyFaceDetector — multi-scale (416 + 608) with NMS
  const [d416, d608] = await Promise.all([
    faceapi.detectAllFaces(imgEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.2 })),
    faceapi.detectAllFaces(imgEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.2 })),
  ]);
  const sorted = [...d416, ...d608].sort((a, b) => b.score - a.score);
  const kept: typeof sorted = [];
  for (const d of sorted) {
    const box = { x: d.box.x, y: d.box.y, width: d.box.width, height: d.box.height };
    if (kept.every((k) => boxIoU(box, { x: k.box.x, y: k.box.y, width: k.box.width, height: k.box.height }) < 0.45)) {
      kept.push(d);
    }
  }
  const f = kept.filter((d) => d.box.width >= MIN_PX && d.box.height >= MIN_PX);
  return {
    count:       f.length,
    boxes:       f.map((d) => normBox(d.box)),
    descriptors: [],
    confidences: f.map((d) => d.score),
    ages: [], genders: [], expressions: [],
  };
}
