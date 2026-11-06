// Non-React helpers for the Home page's upload flow: image thumbnails, face crops,
// geocoding, and calls to the optional backend (see lib/backend.ts).
import { BACKEND_URL } from "./backend";

export type NearbyPlace = {
  name: string;
  type: "restaurant" | "cafe" | "bar" | string;
  cuisine: string;
  distance_m: number;
};

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export async function createThumbnailDataUrl(file: File, maxSize: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function loadImageUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Browser face detection runs on a copy with its long side capped here. At a
// 12 MP phone photo's full size it meant ~30 MediaPipe tiles plus face-api and
// SSD passes over every pixel, several seconds per photo on a phone. Boxes are
// normalized, so they fit the original photo all the same.
export const DETECT_MAX_SIDE = 2048;

export async function loadImageForDetection(file: File, maxSide = DETECT_MAX_SIDE): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageUrl(url);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1) return img;
    const canvas = document.createElement("canvas");
    canvas.width  = Math.round(img.naturalWidth  * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return img;
    const smallUrl = URL.createObjectURL(blob);
    try { return await loadImageUrl(smallUrl); } finally { URL.revokeObjectURL(smallUrl); }
  } finally {
    URL.revokeObjectURL(url);
  }
}

// One square, cover-cropped thumbnail per detected face box (normalized 0-1 coords),
// padded ~20% so the crop isn't a tight box right against the face — used for the
// "pick who to save" picker when multiple faces are detected in one photo.
export async function cropFaceThumbnails(
  file: File,
  boxes: Array<{ x: number; y: number; width: number; height: number }>,
): Promise<string[]> {
  const img = new Image();
  const url = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
  const W = img.naturalWidth, H = img.naturalHeight;
  const SIZE = 120;
  const thumbs = boxes.map((b) => {
    const padX = b.width * W * 0.2, padY = b.height * H * 0.2;
    const sx = Math.max(0, b.x * W - padX);
    const sy = Math.max(0, b.y * H - padY);
    const sw = Math.min(W - sx, b.width * W + padX * 2);
    const sh = Math.min(H - sy, b.height * H + padY * 2);
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d")!;
    const scale = Math.max(SIZE / sw, SIZE / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.drawImage(img, sx, sy, sw, sh, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
    return canvas.toDataURL("image/jpeg", 0.85);
  });
  URL.revokeObjectURL(url);
  return thumbs;
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await res.json();
    const a = data.address || {};
    const parts = [
      a.road,
      a.neighbourhood || a.suburb || a.quarter,
      a.city_district || a.district,
      a.city || a.town || a.village || a.county,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : (data.display_name || "");
  } catch { return ""; }
}

export async function forwardGeocode(query: string): Promise<{ lat: number; lng: number; name: string } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await res.json();
    if (!data[0]) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: data[0].display_name };
  } catch { return null; }
}

export async function fetchNearbyPlaces(lat: number, lng: number): Promise<NearbyPlace[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/nearby-places?lat=${lat}&lng=${lng}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.places ?? [];
  } catch { return []; }
}

// faces=false (face analysis turned off in Profile): the backend only reads EXIF.
export async function analyzeWithBackend(file: File, faces = true) {
  const form = new FormData();
  form.append("file", file);
  form.append("faces", String(faces));
  const res = await fetch(`${BACKEND_URL}/analyze`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  return res.json() as Promise<{
    captureDate: string | null;
    captureTime: string | null;
    latitude:    number | null;
    longitude:   number | null;
    location:    string | null;
    faceCount:   number;
    faceBoxes:   Array<{ x_norm: number; y_norm: number; w_norm: number; h_norm: number }>;
    descriptors: number[][];
    ages:        (number | null)[];
    genders:     (string | null)[];
    confidences: number[];
  }>;
}
