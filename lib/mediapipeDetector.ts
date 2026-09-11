import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

let detectorPromise: Promise<FaceDetector> | null = null;

export function loadMediaPipeDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = FilesetResolver.forVisionTasks("/mediapipe-wasm").then((vision) =>
      FaceDetector.createFromOptions(vision, {
        baseOptions: {
          // full_range (not short_range) — short_range is tuned for a single close-up
          // selfie face within ~2m and misses smaller/angled faces in group photos.
          modelAssetPath: "/models/mediapipe/blaze_face_full_range.tflite",
        },
        runningMode: "IMAGE",
        minDetectionConfidence: 0.4,
      })
    );
  }
  return detectorPromise;
}

export async function detectFacesMediaPipe(
  imgEl: HTMLImageElement
): Promise<Array<{ x: number; y: number; width: number; height: number; score: number }>> {
  const detector = await loadMediaPipeDetector();
  const result = detector.detect(imgEl);
  return result.detections
    .filter((d): d is typeof d & { boundingBox: NonNullable<typeof d.boundingBox> } => !!d.boundingBox)
    .map((d) => ({
      x: d.boundingBox.originX,
      y: d.boundingBox.originY,
      width: d.boundingBox.width,
      height: d.boundingBox.height,
      score: d.categories[0]?.score ?? 1,
    }));
}
