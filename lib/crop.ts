// Cropping a photo to the feed's 4:5 frame before posting. The pure geometry is
// here (tested in crop.test.ts); components/ImageCropper.tsx is the drag/zoom UI
// and cropToBlob renders the chosen part.
import { loadImage } from "./canvasCard";

/** Feed posts (photo and trip) are all shown in this width:height frame. */
export const POST_ASPECT = 4 / 5;
export const POST_OUTPUT_WIDTH = 1080;

export type Size = { width: number; height: number };
/** Image position inside the frame: top-left offset in frame px (≤ 0) and zoom (≥ 1). */
export type CropView = { x: number; y: number; zoom: number };
/** The visible part of the image, as fractions of its natural size. */
export type CropRect = { x: number; y: number; width: number; height: number };

/** Scale at zoom 1: the image just covers the frame (CSS object-fit: cover). */
export function coverScale(image: Size, frame: Size): number {
  return Math.max(frame.width / image.width, frame.height / image.height);
}

/** Keeps the image covering the whole frame, so no empty edge is ever cropped in. */
export function clampView(view: CropView, image: Size, frame: Size): CropView {
  const zoom = Math.min(Math.max(view.zoom, 1), 4);
  const s = coverScale(image, frame) * zoom;
  const w = image.width * s, h = image.height * s;
  return {
    zoom,
    x: Math.min(0, Math.max(frame.width - w, view.x)),
    y: Math.min(0, Math.max(frame.height - h, view.y)),
  };
}

/** Centered at zoom 1 (what the feed showed before cropping existed). */
export function centeredView(image: Size, frame: Size): CropView {
  const s = coverScale(image, frame);
  return clampView({ zoom: 1, x: (frame.width - image.width * s) / 2, y: (frame.height - image.height * s) / 2 }, image, frame);
}

/** Zooms around the frame's center, so the middle of what you see stays put. */
export function zoomView(view: CropView, zoom: number, image: Size, frame: Size): CropView {
  const s0 = coverScale(image, frame) * view.zoom;
  const s1 = coverScale(image, frame) * zoom;
  const cx = frame.width / 2, cy = frame.height / 2;
  return clampView({ zoom, x: cx - (cx - view.x) * (s1 / s0), y: cy - (cy - view.y) * (s1 / s0) }, image, frame);
}

export function cropRectOf(view: CropView, image: Size, frame: Size): CropRect {
  const s = coverScale(image, frame) * view.zoom;
  return {
    x: -view.x / s / image.width,
    y: -view.y / s / image.height,
    width: frame.width / s / image.width,
    height: frame.height / s / image.height,
  };
}

/** Renders `rect` of the image at `src` into a JPEG of POST_OUTPUT_WIDTH × (width / POST_ASPECT). */
export async function cropToBlob(src: string, rect: CropRect, outWidth = POST_OUTPUT_WIDTH, aspect = POST_ASPECT): Promise<Blob> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = Math.round(outWidth / aspect);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");
  ctx.drawImage(img,
    rect.x * img.naturalWidth, rect.y * img.naturalHeight, rect.width * img.naturalWidth, rect.height * img.naturalHeight,
    0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't create the image"))), "image/jpeg", 0.9));
}
