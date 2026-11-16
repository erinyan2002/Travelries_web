// Browser-mode face detection for the Home page upload flow — MediaPipe BlazeFace
// localization + face-api.js confirmation/recognition, with SSD / TinyFaceDetector
// fallbacks. See the "Face detection" section of CLAUDE.md.
import * as faceapi from "face-api.js";
import { detectFacesMediaPipe } from "./mediapipeDetector";
import { boxIoU, pickCropMatch, dedupeFaces, pickSsdAgreement, ssdOnlyFaces, ssdSupports } from "./faceMatching";
import { detectFacesScrfd } from "./scrfdDetector";
import { filterScrfdFaces } from "./scrfd";

export type DetectionResult = {
  count:       number;
  boxes:       Array<{ x: number; y: number; width: number; height: number }>;
  descriptors: number[][];
  confidences: number[];
  ages:        number[];
  genders:     string[];
  expressions: string[];
};

const RETRY_MIN_MP_SCORE = 0.65;

export async function runFaceDetection(
  imgEl: HTMLImageElement,
  modelType: "scrfd" | "mediapipe" | "ssd" | "tiny" | "mediapipe-only",
  hasExtra: boolean,
): Promise<DetectionResult> {
  const MIN_PX = 20;
  const W = imgEl.naturalWidth, H = imgEl.naturalHeight;
  const normBox = (b: { x: number; y: number; width: number; height: number }) =>
    ({ x: b.x / W, y: b.y / H, width: b.width / W, height: b.height / H });

  // Evaluation only (Home's ?detector=mediapipe): MediaPipe's raw boxes, without
  // the face-api confirmation and SSD steps below, to measure what they add.
  if (modelType === "mediapipe-only") {
    const raw = (await detectFacesMediaPipe(imgEl)).filter((b) => b.width >= MIN_PX && b.height >= MIN_PX);
    return {
      count: raw.length, boxes: raw.map(normBox), descriptors: [],
      confidences: raw.map((b) => b.score), ages: [], genders: [], expressions: [],
    };
  }

  // Primary: SCRFD finds the faces (it was trained on WIDER FACE, which has
  // masked, half-hidden and tiny faces), and face-api only computes each face's
  // 128-dim descriptor, so People keeps matching photos saved before. The old
  // MediaPipe + face-api confirmation chain below missed most masked faces (face-api
  // and SSD were trained on unmasked ones) and once kept a box over a torso.
  if (modelType === "scrfd") {
    const faces = filterScrfdFaces(
      (await detectFacesScrfd(imgEl)).map((f) => ({ ...f, box: clampBox(f.box, W, H) }))
        .filter((f) => f.box.width >= MIN_PX && f.box.height >= MIN_PX),
    ).sort((a, b) => a.box.x - b.box.x); // stable left-to-right numbering
    const descriptors: number[][] = [];
    for (const f of faces) descriptors.push(await describeFace(imgEl, f.box));
    return {
      count:       faces.length,
      boxes:       faces.map((f) => normBox(f.box)),
      descriptors,
      confidences: faces.map((f) => f.score),
      ages: [], genders: [], expressions: [],
    };
  }

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

    // Second opinion: face-api's SSD over the whole photo (loaded in the
    // background after MediaPipe; skipped until it's ready). See pickSsdAgreement /
    // ssdOnlyFaces in faceMatching.ts for how it's used.
    const ssdLoaded = faceapi.nets.ssdMobilenetv1.isLoaded;
    const ssdFaces: Confirmed[] = ssdLoaded
      ? (await faceapi.detectAllFaces(imgEl, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
          .withFaceLandmarks().withFaceDescriptors())
          .filter((r) => r.detection.box.width >= MIN_PX && r.detection.box.height >= MIN_PX)
          .map((r) => ({
            box: { x: r.detection.box.x, y: r.detection.box.y, width: r.detection.box.width, height: r.detection.box.height },
            score: r.detection.score,
            descriptor: Array.from(r.descriptor),
          }))
      : [];

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
      // The permissive retry (score 0.01) also "confirmed" MediaPipe's false boxes on
      // food, a cake, a Ferris wheel or the back of a head. On 59 real uploads, every such box
      // had a MediaPipe score <= 0.64, while real faces that only the retry caught
      // (cut off at the frame edge, turned away) scored 0.68-0.89. So the retry
      // only gets to rescue a box MediaPipe itself was sure about.
      // A retry-only match also needs SSD to see a face there (ssdSupports), once SSD
      // has loaded; before that the retry is taken on its own as before.
      const firstPass = pickCropMatch(await detectInCrop(tinyOpts), box);
      const retried = !firstPass && box.score >= RETRY_MIN_MP_SCORE
        ? pickCropMatch(await detectInCrop(retryOpts), box) : null;
      const match = firstPass
        ?? (retried && (!ssdLoaded || ssdSupports(ssdFaces, retried.box)) ? retried : null);
      if (!match) {
        const agreed = pickSsdAgreement(ssdFaces, box);
        if (agreed) { confirmed.push(agreed); continue; }
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
    confirmed.push(...ssdOnlyFaces(ssdFaces, confirmed));
    const kept = dedupeFaces(confirmed);
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

function clampBox(b: { x: number; y: number; width: number; height: number }, W: number, H: number) {
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  return { x, y, width: Math.min(W, b.x + b.width) - x, height: Math.min(H, b.y + b.height) - y };
}

// face-api's 128-dim descriptor for a face found by another detector: landmarks on
// the box crop, then the dlib-style aligned chip, exactly as face-api's own
// withFaceLandmarks().withFaceDescriptors() does it. If alignment fails, the plain
// box crop is described instead. Never [], because an empty descriptor marks a
// removed face (isFaceRemoved).
async function describeFace(
  img: HTMLImageElement,
  b: { x: number; y: number; width: number; height: number },
): Promise<number[]> {
  const [crop] = await faceapi.extractFaces(img, [new faceapi.Rect(b.x, b.y, b.width, b.height)]);
  try {
    const lm = await faceapi.nets.faceLandmark68Net.detectLandmarks(crop) as faceapi.FaceLandmarks68;
    const rect = lm.shiftBy<faceapi.FaceLandmarks68>(b.x, b.y).align(null, { useDlibAlignment: true });
    const [chip] = await faceapi.extractFaces(img, [rect]);
    return Array.from(await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(chip) as Float32Array);
  } catch (e) {
    console.warn("Face alignment failed, describing the unaligned crop:", e);
    return Array.from(await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(crop) as Float32Array);
  }
}
