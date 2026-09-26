// Groups detected faces into people for the Faces page. Pure (no I/O) so it can
// be unit-tested — see lib/faceClustering.test.ts.
import type { FacePhoto } from "./types";
import type { Person } from "./peopleApi";

export type FaceEntry = { photo: FacePhoto; boxIndex: number };
// personId set means this group came from a manual tag/merge (supabase `people`
// table) rather than pure descriptor-distance clustering — see buildPersonGroups().
export type PersonCluster = { id: string; label: string; faces: FaceEntry[]; centroid: number[]; personId?: string };

export function euclidean(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// Fixed after tuning — 0.55 gave the most accurate person grouping in testing.
// Applies to 128-dim descriptors (browser face-api.js, or the backend's dlib tier).
export const MATCH_THRESHOLD = 0.55;

// The backend's InsightFace tier saves 512-dim ArcFace embeddings, which live in
// a completely different space from the 128-dim ones — the two can never be
// compared to each other, and need their own threshold. On unit-length ArcFace
// vectors, distance 1.05 ≈ cosine similarity 0.45 (InsightFace's usual
// same-person cut-off is ~0.4-0.5).
const ARCFACE_DIM = 512;
const ARCFACE_MATCH_THRESHOLD = 1.05;

function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n > 0 ? v.map((x) => x / n) : v;
}

// Rows saved before the backend switched to normed_embedding hold raw ArcFace
// vectors (norm ~20+), so normalize every 512-dim descriptor on read.
export function prepDescriptor(desc: number[]): number[] {
  return desc.length === ARCFACE_DIM ? l2normalize(desc) : desc;
}

/** `skip`: faces (`${photoId}_${index}`) already placed elsewhere, e.g. joined to a named person. */
export function clusterByPerson(photos: FacePhoto[], threshold: number, skip?: Set<string>): PersonCluster[] {
  const clusters: PersonCluster[] = [];
  // Sort oldest-first so the seed face of each cluster is stable when new photos are added later
  const sorted = [...photos].sort(
    (a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
  );
  for (const photo of sorted) {
    if (!photo.descriptors?.length || !photo.boxes?.length) continue;
    for (let i = 0; i < photo.descriptors.length; i++) {
      if (!photo.descriptors[i]?.length) continue;
      const desc = prepDescriptor(photo.descriptors[i]);
      const isArcFace = desc.length === ARCFACE_DIM;
      const limit = isArcFace ? ARCFACE_MATCH_THRESHOLD : threshold;
      // Manually tagged/merged faces are assembled into their own confirmed
      // groups in buildPersonGroups() instead — skip them here so a stray
      // distance match can't pull them into a different auto-cluster.
      if (photo.personIds?.[i]) continue;
      if (skip?.has(`${photo.id}_${i}`)) continue;
      let nearest: PersonCluster | null = null;
      let minDist = Infinity;
      for (const c of clusters) {
        // Same-photo constraint: two faces from the same photo can never be the same person
        if (c.faces.some(f => f.photo.id === photo.id)) continue;
        const d = euclidean(desc, c.centroid); // Infinity across 128/512-dim
        if (d < minDist) { minDist = d; nearest = c; }
      }
      if (nearest && minDist < limit) {
        nearest.faces.push({ photo, boxIndex: i });
        const n = nearest.faces.length;
        const mean = nearest.centroid.map((v, j) => (v * (n - 1) + desc[j]) / n);
        // Keep ArcFace centroids on the unit sphere so the threshold stays valid.
        nearest.centroid = isArcFace ? l2normalize(mean) : mean;
      } else {
        // Stable ID based on seed face — does not change when new photos are added
        clusters.push({ id: `${photo.id}_${i}`, label: `Person ${clusters.length + 1}`, faces: [{ photo, boxIndex: i }], centroid: [...desc] });
      }
    }
  }
  return clusters.sort((a, b) => b.faces.length - a.faces.length).map((c, i) => ({ ...c, label: `Person ${i + 1}` }));
}

// Confirmed groups (manual tag at upload, or "merge into..." on this page) are
// pulled out before clusterByPerson() runs and assembled here from photos.person_ids
// — a manual override always wins over descriptor distance and never re-splits.
// Untagged faces are then matched against those named people first (same distance
// rules as auto-clustering), and only the rest are auto-clustered. Without that,
// a new photo of someone you had already named always showed up as a separate
// "Person N" next to them, because named groups had no centroid to match against.
export function buildPersonGroups(photos: FacePhoto[], people: Person[], threshold: number): PersonCluster[] {
  const sorted = [...photos].sort(
    (a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
  );
  const confirmedMap = new Map<string, FaceEntry[]>();
  for (const photo of sorted) {
    photo.personIds?.forEach((personId, i) => {
      if (!personId || !photo.boxes?.[i]) return;
      if (!confirmedMap.has(personId)) confirmedMap.set(personId, []);
      confirmedMap.get(personId)!.push({ photo, boxIndex: i });
    });
  }
  const confirmed: PersonCluster[] = [...confirmedMap.entries()].map(([personId, faces]) => ({
    id: personId,
    personId,
    label: people.find((p) => p.id === personId)?.name ?? "Unnamed",
    faces,
    centroid: [],
  }));

  // One running centroid per descriptor size (a person merged across browser and
  // backend uploads has both 128- and 512-dim faces, which can't be averaged).
  const centroids = confirmed.map((g) => {
    const byDim = new Map<number, { mean: number[]; n: number }>();
    for (const { photo, boxIndex } of g.faces) {
      const raw = photo.descriptors?.[boxIndex];
      if (!raw?.length) continue;
      addToCentroid(byDim, prepDescriptor(raw));
    }
    return byDim;
  });

  const joined = new Set<string>();
  if (confirmed.length > 0) {
    for (const photo of sorted) {
      photo.descriptors?.forEach((raw, i) => {
        if (!raw?.length || !photo.boxes?.[i] || photo.personIds?.[i]) return;
        const desc = prepDescriptor(raw);
        const limit = desc.length === ARCFACE_DIM ? ARCFACE_MATCH_THRESHOLD : threshold;
        let best = -1, bestDist = Infinity;
        confirmed.forEach((g, gi) => {
          if (g.faces.some((f) => f.photo.id === photo.id)) return; // same-photo constraint
          const c = centroids[gi].get(desc.length);
          if (!c) return;
          const d = euclidean(desc, c.mean);
          if (d < bestDist) { bestDist = d; best = gi; }
        });
        if (best >= 0 && bestDist < limit) {
          confirmed[best].faces.push({ photo, boxIndex: i });
          addToCentroid(centroids[best], desc);
          joined.add(`${photo.id}_${i}`);
        }
      });
    }
  }

  const auto = clusterByPerson(photos, threshold, joined);
  return [...confirmed, ...auto].sort((a, b) => b.faces.length - a.faces.length);
}

function addToCentroid(byDim: Map<number, { mean: number[]; n: number }>, desc: number[]) {
  const cur = byDim.get(desc.length);
  if (!cur) { byDim.set(desc.length, { mean: [...desc], n: 1 }); return; }
  const n = cur.n + 1;
  const mean = cur.mean.map((v, j) => (v * cur.n + desc[j]) / n);
  cur.mean = desc.length === ARCFACE_DIM ? l2normalize(mean) : mean;
  cur.n = n;
}
