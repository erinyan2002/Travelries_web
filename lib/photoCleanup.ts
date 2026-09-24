// Pure image-analysis helpers for the Clean Up page (app/cleanup/page.tsx):
// near-duplicate detection (difference hash + capture-time proximity) and blur
// detection (variance of the Laplacian). No DOM here — the page draws each photo
// to a canvas and passes the pixels in — so this is unit-testable.

// RGBA pixels -> luminance (0-255), one value per pixel.
export function toGrayscale(rgba: Uint8ClampedArray | number[], w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return out;
}

// Difference hash of a 9x8 grayscale image: 64 bits, each "is this pixel
// brighter than its right neighbour". Robust to resizing/re-compression and
// small exposure changes, so burst shots of one scene land a few bits apart.
export const DHASH_W = 9, DHASH_H = 8;
export function dHash(gray9x8: Float32Array | number[]): string {
  let bits = "";
  for (let y = 0; y < DHASH_H; y++) {
    for (let x = 0; x < DHASH_W - 1; x++) {
      bits += gray9x8[y * DHASH_W + x] > gray9x8[y * DHASH_W + x + 1] ? "1" : "0";
    }
  }
  return bits;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

// Variance of the 4-neighbour Laplacian — high for crisp edges, low for blur
// (and for genuinely flat images like a clear sky, hence "may be blurry").
export function laplacianVariance(gray: Float32Array | number[], w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export type AnalyzedPhoto = {
  id: string;
  hash: string;
  sharpness: number;
  takenAt: number | null; // ms since epoch, null when unknown
};

// Starting points, not calibrated on a labelled set — the UI only ever suggests.
export const SIMILAR_MAX_HAMMING = 10;        // of 64 bits
export const SIMILAR_STRICT_HAMMING = 5;      // when capture times are unknown
export const SIMILAR_MAX_GAP_MS = 10 * 60 * 1000;
export const BLURRY_BELOW = 60;               // Laplacian variance at ANALYSIS_SIZE
export const ANALYSIS_SIZE = 512;             // long side, px, for the blur measure

function isSimilar(a: AnalyzedPhoto, b: AnalyzedPhoto): boolean {
  const d = hammingDistance(a.hash, b.hash);
  if (a.takenAt != null && b.takenAt != null) {
    return d <= SIMILAR_MAX_HAMMING && Math.abs(a.takenAt - b.takenAt) <= SIMILAR_MAX_GAP_MS;
  }
  return d <= SIMILAR_STRICT_HAMMING;
}

// Groups of 2+ near-duplicate photos (transitively linked), each sorted
// sharpest-first so [0] is the suggested one to keep. Groups are ordered
// largest-first.
export function groupSimilar(photos: AnalyzedPhoto[]): AnalyzedPhoto[][] {
  const parent = photos.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      if (isSimilar(photos[i], photos[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, AnalyzedPhoto[]>();
  photos.forEach((p, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), p]);
  });
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => b.sharpness - a.sharpness))
    .sort((a, b) => b.length - a.length);
}

export function findBlurry(photos: AnalyzedPhoto[], threshold = BLURRY_BELOW): AnalyzedPhoto[] {
  return photos.filter((p) => p.sharpness < threshold).sort((a, b) => a.sharpness - b.sharpness);
}
