// Runs SCRFD (InsightFace det_10g, public/models/scrfd/det_10g.onnx) in the browser
// with onnxruntime-web's WASM backend. The runtime's .wasm/.mjs are self-hosted
// under public/ort-wasm (copied there by _scripts/download-models.sh), so the
// detector doesn't depend on a CDN. Decoding lives in lib/scrfd.ts.
import type { InferenceSession } from "onnxruntime-web";
import { decodeScrfd, SCRFD_DETECT_SCORE, type ScrfdFace } from "./scrfd";

export const SCRFD_MODEL_URL = "/models/scrfd/det_10g.onnx";
// The model takes any multiple of 32. 640 is what InsightFace uses; on the test
// photos it found every face the backend's tiled 1280 pass did.
export const SCRFD_INPUT = 640;

type Ort = typeof import("onnxruntime-web");
let sessionPromise: Promise<{ ort: Ort; session: InferenceSession }> | null = null;

export function loadScrfd(): Promise<{ ort: Ort; session: InferenceSession }> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      // Imported here, not at the top, so the server render never loads it.
      const ort = await import("onnxruntime-web/wasm");
      ort.env.wasm.wasmPaths = "/ort-wasm/";
      // Threads need a cross-origin-isolated page, which this app isn't.
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(SCRFD_MODEL_URL, {
        executionProviders: ["wasm"], graphOptimizationLevel: "all",
      });
      return { ort: ort as unknown as Ort, session };
    })().catch((e) => { sessionPromise = null; throw e; });
  }
  return sessionPromise;
}

export async function detectFacesScrfd(img: HTMLImageElement | HTMLCanvasElement): Promise<ScrfdFace[]> {
  const { ort, session } = await loadScrfd();
  const W = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const H = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const size = SCRFD_INPUT;
  // Letterbox: scale to fit, top-left aligned, black padding (as scrfd.py does).
  const scale = Math.min(size / W, size / H);
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, Math.round(W * scale), Math.round(H * scale));
  const px = ctx.getImageData(0, 0, size, size).data;
  // NCHW, RGB, (v - 127.5) / 128
  const plane = size * size;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    data[i] = (px[i * 4] - 127.5) / 128;
    data[plane + i] = (px[i * 4 + 1] - 127.5) / 128;
    data[2 * plane + i] = (px[i * 4 + 2] - 127.5) / 128;
  }
  const input = new ort.Tensor("float32", data, [1, 3, size, size]);
  const results = await session.run({ [session.inputNames[0]]: input });
  const outputs = session.outputNames.map((n) => results[n].data as Float32Array);
  input.dispose();
  for (const n of session.outputNames) results[n].dispose();
  return decodeScrfd(outputs, size, size, scale, SCRFD_DETECT_SCORE);
}
