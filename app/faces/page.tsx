"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import BottomNav from "@/components/BottomNav";
import { supabase } from "@/lib/supabase";
import { FacePhoto } from "@/lib/types";
import { fetchFacePhotos, updateFacePersonIds, removeFaceFromPhoto } from "@/lib/photosApi";
import { deletePhotoEverywhere } from "@/lib/savedUtils";
import { fetchPeople, createPerson, renamePerson, Person } from "@/lib/peopleApi";
import { useRouter } from "next/navigation";
import {
  Users, ImageIcon, Images, MapPin, CalendarDays, Trash2, X,
  Terminal, AlertTriangle, Eye, Scan, Pencil, Check,
} from "lucide-react";

type FaceEntry = { photo: FacePhoto; boxIndex: number };
// personId set means this group came from a manual tag/merge (supabase `people`
// table) rather than pure descriptor-distance clustering — see buildPersonGroups().
type PersonCluster = { id: string; label: string; faces: FaceEntry[]; centroid: number[]; personId?: string };

const EXPRESSION_EMOJI: Record<string, string> = {
  happy: "😊", sad: "😢", angry: "😠", surprised: "😮",
  fearful: "😨", disgusted: "🤢", neutral: "",
};

// Per-person color palette (rings cycle through these)
const PALETTE = [
  { ring: "ring-violet-400",  bg: "bg-violet-100",  text: "text-violet-700"  },
  { ring: "ring-blue-400",    bg: "bg-blue-100",    text: "text-blue-700"    },
  { ring: "ring-emerald-400", bg: "bg-emerald-100", text: "text-emerald-700" },
  { ring: "ring-amber-400",   bg: "bg-amber-100",   text: "text-amber-700"   },
  { ring: "ring-rose-400",    bg: "bg-rose-100",    text: "text-rose-700"    },
  { ring: "ring-indigo-400",  bg: "bg-indigo-100",  text: "text-indigo-700"  },
  { ring: "ring-pink-400",    bg: "bg-pink-100",    text: "text-pink-700"    },
  { ring: "ring-cyan-400",    bg: "bg-cyan-100",    text: "text-cyan-700"    },
];

// A face "removed" via removeFaceFromPhoto has its descriptor tombstoned to an
// empty array — but only when the photo genuinely has real per-face descriptor
// data (some legacy/fallback detection paths save an entirely-empty descriptors
// array for every face, which must NOT be mistaken for every face being removed).
function isFaceRemoved(photo: FacePhoto, i: number): boolean {
  if (!photo.descriptors?.length) return false;
  return !photo.descriptors[i]?.length;
}

function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// Fixed after tuning — 0.55 gave the most accurate person grouping in testing.
const MATCH_THRESHOLD = 0.55;

function clusterByPerson(photos: FacePhoto[], threshold: number): PersonCluster[] {
  const clusters: PersonCluster[] = [];
  // Sort oldest-first so the seed face of each cluster is stable when new photos are added later
  const sorted = [...photos].sort(
    (a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
  );
  for (const photo of sorted) {
    if (!photo.descriptors?.length || !photo.boxes?.length) continue;
    for (let i = 0; i < photo.descriptors.length; i++) {
      const desc = photo.descriptors[i];
      if (!desc?.length) continue;
      // Manually tagged/merged faces are assembled into their own confirmed
      // groups in buildPersonGroups() instead — skip them here so a stray
      // distance match can't pull them into a different auto-cluster.
      if (photo.personIds?.[i]) continue;
      let nearest: PersonCluster | null = null;
      let minDist = Infinity;
      for (const c of clusters) {
        // Same-photo constraint: two faces from the same photo can never be the same person
        if (c.faces.some(f => f.photo.id === photo.id)) continue;
        const d = euclidean(desc, c.centroid);
        if (d < minDist) { minDist = d; nearest = c; }
      }
      if (nearest && minDist < threshold) {
        nearest.faces.push({ photo, boxIndex: i });
        const n = nearest.faces.length;
        nearest.centroid = nearest.centroid.map((v, j) => (v * (n - 1) + desc[j]) / n);
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
function buildPersonGroups(photos: FacePhoto[], people: Person[], threshold: number): PersonCluster[] {
  const confirmedMap = new Map<string, FaceEntry[]>();
  for (const photo of photos) {
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

  const auto = clusterByPerson(photos, threshold);
  return [...confirmed, ...auto].sort((a, b) => b.faces.length - a.faces.length);
}

// ── Canvas components ─────────────────────────────────────────────────────────
function PhotoWithBoxes({ photo }: { photo: FacePhoto }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.src = photo.imageUrl;
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      if (!photo.boxes?.length) return;
      const lineW = Math.max(3, img.width / 150);
      const labelH = Math.max(26, img.height / 22);
      const fontSize = Math.max(13, labelH * 0.62);
      photo.boxes.forEach((box, i) => {
        if (isFaceRemoved(photo, i)) return;
        const x = box.x * img.width, y = box.y * img.height;
        const w = box.width * img.width, h = box.height * img.height;
        const conf = photo.confidences?.[i] ?? 1;
        const [stroke, fill] =
          conf >= 0.7 ? ["#22c55e", "rgba(34,197,94,0.88)"]
          : conf >= 0.4 ? ["#f59e0b", "rgba(245,158,11,0.88)"]
          : ["#ef4444", "rgba(239,68,68,0.88)"];
        ctx.strokeStyle = stroke; ctx.lineWidth = lineW;
        ctx.strokeRect(x, y, w, h);
        const expr  = photo.expressions?.[i];
        const label = `#${i + 1}` + (expr && expr !== "neutral" ? ` ${EXPRESSION_EMOJI[expr] ?? ""}` : "");
        const lh = Math.min(labelH, h * 0.35);
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, lh);
        ctx.fillStyle = "white";
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText(label, x + 6, y + lh * 0.8);
      });
    };
  }, [photo]);
  return <canvas ref={canvasRef} className="w-full h-auto block" />;
}

function FaceChip({ imageUrl, box, index, size = 64, ringClass = "ring-blue-400" }: {
  imageUrl: string;
  box: { x: number; y: number; width: number; height: number };
  index: number;
  size?: number;
  ringClass?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      const px = box.x * img.width, py = box.y * img.height;
      const pw = box.width * img.width, ph = box.height * img.height;
      const pad = Math.min(pw, ph) * 0.25;
      const sx = Math.max(0, px - pad), sy = Math.max(0, py - pad);
      const sw = Math.min(img.width - sx, pw + pad * 2);
      const sh = Math.min(img.height - sy, ph + pad * 2);
      canvas.width = size; canvas.height = size;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
    };
  }, [imageUrl, box, size]);
  return (
    <div className="text-center flex-shrink-0">
      <canvas
        ref={canvasRef}
        style={{ width: `${size}px`, height: `${size}px` }}
        className={`rounded-full ring-2 ring-offset-2 ${ringClass} block shadow-sm`}
      />
      <span className="text-[10px] text-slate-400 mt-1.5 block">#{index + 1}</span>
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────
function PhotoModal({ photo, onClose, onDelete, onRemoveFace }: {
  photo: FacePhoto; onClose: () => void; onDelete: (id: string) => void;
  onRemoveFace: (photoId: string, boxIndex: number) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[2000] flex items-end sm:items-center justify-center sm:p-5 overflow-y-auto" onClick={onClose}>
      <div className="w-full sm:max-w-[600px] bg-white sm:rounded-3xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="bg-gradient-to-r from-sky-500 to-blue-600 px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-white text-sm truncate max-w-[260px]">{photo.fileName}</h3>
            <p className="text-sky-100 text-xs mt-0.5 flex items-center gap-1.5">
              <Users size={10} /> {photo.faceCount} face(s)
              {photo.location && <><span>·</span><MapPin size={10} />{photo.location.split(",")[0]}</>}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Photo with boxes */}
        <div className="bg-slate-950 max-h-[55vh] overflow-hidden flex items-center justify-center">
          <PhotoWithBoxes photo={photo} />
        </div>

        {/* Face chips strip */}
        {photo.boxes && photo.boxes.length > 0 && (
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Detected faces ({photo.faceCount})
            </p>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {photo.boxes.map((box, i) => {
                if (isFaceRemoved(photo, i)) return null;
                return (
                  <div key={i} className="relative flex-shrink-0">
                    <FaceChip imageUrl={photo.imageUrl} box={box} index={i} size={60}
                      ringClass={PALETTE[i % PALETTE.length].ring} />
                    <button
                      onClick={() => {
                        if (confirm("Remove this face? The photo stays in your Albums.")) {
                          onRemoveFace(photo.id, i);
                        }
                      }}
                      title="Remove this face"
                      className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center rounded-full bg-red-500 hover:bg-red-600 text-white shadow-sm transition-colors">
                      <X size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Meta info */}
        <div className="px-5 py-4 grid grid-cols-2 gap-2 border-b border-slate-100">
          {photo.location && (
            <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
              <MapPin size={13} className="text-blue-500 flex-shrink-0" />
              <span className="text-xs text-slate-700 font-medium truncate">{photo.location.split(",")[0]}</span>
            </div>
          )}
          <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
            <CalendarDays size={13} className="text-slate-400 flex-shrink-0" />
            <span className="text-xs text-slate-700 font-medium">{photo.uploadedAt.slice(0, 10)}</span>
          </div>
        </div>

        {/* Delete */}
        <div className="px-5 py-4">
          <button
            onClick={() => { onDelete(photo.id); onClose(); }}
            className="w-full flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 active:scale-[0.98] text-white py-3 rounded-2xl font-bold text-sm transition-all shadow-lg shadow-red-200"
          >
            <Trash2 size={15} /> Delete Photo
          </button>
        </div>
      </div>
    </div>
  );
}

function PersonModal({ cluster, onClose, colorIdx, onRemoveFace }: {
  cluster: PersonCluster; onClose: () => void; colorIdx: number;
  onRemoveFace: (photoId: string, boxIndex: number) => void;
}) {
  const color = PALETTE[colorIdx % PALETTE.length];
  const rep = cluster.faces[0];
  const repBox = rep?.photo.boxes?.[rep.boxIndex];
  const photoCount = new Set(cluster.faces.map(f => f.photo.id)).size;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[2000] flex items-end sm:items-center justify-center sm:p-5 overflow-y-auto" onClick={onClose}>
      <div className="w-full sm:max-w-[640px] bg-white sm:rounded-3xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-5 py-4 flex items-center gap-4 flex-shrink-0">
          {repBox && (
            <FaceChip imageUrl={rep.photo.imageUrl} box={repBox} index={rep.boxIndex}
              size={56} ringClass={color.ring} />
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-black text-white text-lg">{cluster.label}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${color.bg} ${color.text}`}>
                {cluster.faces.length} appearance{cluster.faces.length !== 1 ? "s" : ""}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/70">
                {photoCount} photo{photoCount !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Gallery */}
        <div className="p-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            {cluster.faces.map((face, idx) => {
              const box = face.photo.boxes?.[face.boxIndex];
              return (
                <div key={`${face.photo.id}_${face.boxIndex}_${idx}`} className="relative bg-slate-50 rounded-2xl overflow-hidden border border-slate-100 shadow-sm">
                  <button
                    onClick={() => {
                      if (confirm("Remove this face? The photo stays in your Albums.")) {
                        onRemoveFace(face.photo.id, face.boxIndex);
                      }
                    }}
                    title="Remove this face"
                    className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-black/50 hover:bg-red-500 text-white transition-colors">
                    <X size={12} />
                  </button>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={face.photo.imageUrl} alt={face.photo.fileName} className="w-full h-32 object-cover bg-slate-200" />
                  <div className="p-2.5 flex items-center gap-2.5">
                    {box && (
                      <FaceChip imageUrl={face.photo.imageUrl} box={box} index={face.boxIndex}
                        size={40} ringClass={color.ring} />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{face.photo.fileName}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{face.photo.uploadedAt.slice(0, 10)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function getGroupKey(photo: FacePhoto): string {
  if (photo.location) {
    const parts = photo.location.split(",").map((s) => s.trim());
    return parts.slice(-2).join(", ");
  }
  const d = new Date(photo.uploadedAt);
  const y = d.getFullYear();
  const m = d.toLocaleString("en", { month: "short" });
  return y > 1970 ? `${m} ${y}` : "Other";
}

function FacesSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-36 bg-gradient-to-br from-sky-200 to-blue-200 rounded-3xl" />
      <div className="h-12 bg-slate-100 rounded-2xl" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[0,1,2,3,4,5].map((i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 text-center">
            <div className="w-16 h-16 bg-slate-200 rounded-full mx-auto mb-3" />
            <div className="h-3.5 bg-slate-200 rounded-full w-2/3 mx-auto mb-2" />
            <div className="h-3 bg-slate-100 rounded-full w-1/2 mx-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function FacesPage() {
  const [storedPhotos,    setStoredPhotos]    = useState<FacePhoto[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [activeTab,       setActiveTab]       = useState<"people" | "photos">("people");
  const [selectedPhoto,   setSelectedPhoto]   = useState<FacePhoto | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<{ cluster: PersonCluster; idx: number } | null>(null);
  const [customLabels,    setCustomLabels]    = useState<Record<string, string>>({});
  const [editingId,       setEditingId]       = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editDraft,       setEditDraft]       = useState("");
  const [uid,             setUid]             = useState<string | null>(null);
  const [people,          setPeople]          = useState<Person[]>([]);
  const [merging,         setMerging]         = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      const u = user?.id ?? "guest";
      setUid(u);

      const faces = u === "guest" ? [] : await fetchFacePhotos(u);
      const peopleList = u === "guest" ? [] : await fetchPeople(u);

      const rawLabels: Record<string, string> = JSON.parse(localStorage.getItem(`face-labels-${u}`) ?? "{}");
      // Discard labels stored in old pX format (cluster IDs are now photoId_boxIndex)
      const validLabels = Object.fromEntries(
        Object.entries(rawLabels).filter(([k]) => !k.match(/^p\d+$/))
      );
      setCustomLabels(validLabels);
      setStoredPhotos(faces);
      setPeople(peopleList);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    if (!uid) return;
    localStorage.setItem(`face-labels-${uid}`, JSON.stringify(customLabels));
  }, [customLabels, uid]);

  // Removes one face from a photo (see removeFaceFromPhoto) and keeps every
  // open view in sync: the photo's own local state, and — since PersonModal/
  // PhotoModal are handed a snapshot of the photo/cluster at open time, not a
  // live reference — the currently-open modal(s) too, closing them if that was
  // the last face left to show.
  async function handleRemoveFace(photoId: string, boxIndex: number) {
    if (!uid) return;
    try {
      await removeFaceFromPhoto(uid, photoId, boxIndex);
      setStoredPhotos((prev) => prev.flatMap((p) => {
        if (p.id !== photoId) return [p];
        const newFaceCount = Math.max(0, (p.faceCount ?? 0) - 1);
        if (newFaceCount === 0) return []; // no faces left — no longer a face photo
        const descriptors = [...(p.descriptors ?? [])];
        descriptors[boxIndex] = [];
        const personIds = [...(p.personIds ?? [])];
        personIds[boxIndex] = null;
        return [{ ...p, descriptors, personIds, faceCount: newFaceCount }];
      }));
      setSelectedCluster((prev) => {
        if (!prev) return prev;
        const faces = prev.cluster.faces.filter((f) => !(f.photo.id === photoId && f.boxIndex === boxIndex));
        return faces.length === 0 ? null : { ...prev, cluster: { ...prev.cluster, faces } };
      });
      setSelectedPhoto((prev) => {
        if (!prev || prev.id !== photoId) return prev;
        const newFaceCount = Math.max(0, (prev.faceCount ?? 0) - 1);
        if (newFaceCount === 0) return null;
        const descriptors = [...(prev.descriptors ?? [])];
        descriptors[boxIndex] = [];
        return { ...prev, descriptors, faceCount: newFaceCount };
      });
    } catch (err) {
      console.error("Remove face failed:", err);
      alert("Couldn't remove this face. Please try again.");
    }
  }

  async function handleDelete(id: string) {
    const fileName = storedPhotos.find((p) => p.id === id)?.fileName;
    try {
      await deletePhotoEverywhere(id, fileName);
      // deletePhotoEverywhere also sweeps every other row sharing this filename —
      // drop those from local state too, not just the clicked id, so a same-named
      // duplicate card doesn't linger looking deletable when it's already gone.
      setStoredPhotos((prev) => prev.filter((p) => p.id !== id && (!fileName || p.fileName !== fileName)));
    } catch (err) {
      // A duplicate-filename sibling delete earlier in this session may have already
      // swept this exact row — treat that as already-deleted, not a real failure.
      if (err instanceof Error && err.message === "Photo not found or already deleted") {
        setStoredPhotos((prev) => prev.filter((p) => p.id !== id && (!fileName || p.fileName !== fileName)));
      } else {
        console.error("Delete failed:", err);
        alert("Couldn't delete this photo. Please try again.");
      }
    } finally {
      setConfirmDeleteId(null);
    }
  }

  async function handleClearAll() {
    if (!uid) return;
    const failed: FacePhoto[] = [];
    for (const p of storedPhotos) {
      try {
        await deletePhotoEverywhere(p.id, p.fileName);
      } catch (err) {
        // deletePhotoEverywhere also sweeps other rows sharing this filename, so an
        // earlier iteration here may have already removed this one — not a real failure.
        if (err instanceof Error && err.message === "Photo not found or already deleted") continue;
        console.error(`Delete failed for ${p.fileName}:`, err);
        failed.push(p);
      }
    }
    localStorage.removeItem(`face-labels-${uid}`);
    setStoredPhotos(failed);
    setCustomLabels({});
    setConfirmClearAll(false);
    if (failed.length > 0) {
      alert(`${failed.length} photo(s) couldn't be deleted. Please try again.`);
    }
  }

  const clusters      = useMemo(() => buildPersonGroups(storedPhotos, people, MATCH_THRESHOLD), [storedPhotos, people]);
  const hasDescriptors = storedPhotos.some((p) => p.descriptors?.length);
  const totalFaces    = storedPhotos.reduce((s, p) => s + (p.faceCount ?? 0), 0);

  // Confirmed (merged/tagged) clusters are named from the `people` table; everything
  // else still uses the localStorage custom-name map keyed by the cluster's seed id.
  function labelOf(cluster: PersonCluster): string {
    return cluster.personId ? cluster.label : (customLabels[cluster.id] ?? cluster.label);
  }

  async function commitRename(cluster: PersonCluster) {
    const name = editDraft.trim() || cluster.label;
    setEditingId(null);
    if (cluster.personId) {
      try {
        await renamePerson(cluster.personId, name);
        setPeople((prev) => prev.map((p) => (p.id === cluster.personId ? { ...p, name } : p)));
      } catch (err) {
        console.error("Rename failed:", err);
        alert("Couldn't rename this person. Please try again.");
      }
    } else {
      setCustomLabels((prev) => ({ ...prev, [cluster.id]: name }));
    }
  }

  // Merges two Person cards into one: reuses either side's existing person_id if
  // it has one, otherwise creates a new `people` row, then writes that person_id
  // onto every face in both groups (batched per photo row, preserving any other
  // face's existing tag on the same row) so the merge survives a reload/re-cluster.
  async function handleMerge(source: PersonCluster, target: PersonCluster) {
    if (!uid || source.id === target.id) return;
    const sourceLabel = labelOf(source);
    const targetLabel = labelOf(target);
    if (!confirm(`Merge "${sourceLabel}" into "${targetLabel}"?`)) return;
    setMerging(source.id);
    try {
      let personId = target.personId ?? source.personId;
      if (!personId) {
        const created = await createPerson(uid, targetLabel);
        personId = created.id;
        setPeople((prev) => [...prev, created]);
      }
      const updates = new Map<string, { photo: FacePhoto; indices: number[] }>();
      for (const face of [...source.faces, ...target.faces]) {
        const entry = updates.get(face.photo.id) ?? { photo: face.photo, indices: [] };
        entry.indices.push(face.boxIndex);
        updates.set(face.photo.id, entry);
      }
      for (const { photo, indices } of updates.values()) {
        const current = photo.personIds ? [...photo.personIds] : new Array(photo.boxes?.length ?? 0).fill(null);
        indices.forEach((i) => { current[i] = personId; });
        await updateFacePersonIds(uid, photo.id, photo.fileName, photo.imageUrl, current);
      }
      setStoredPhotos(await fetchFacePhotos(uid));
    } catch (err) {
      console.error("Merge failed:", err);
      alert("Couldn't merge these people. Please try again.");
    } finally {
      setMerging(null);
    }
  }

  const photoGroups: Record<string, FacePhoto[]> = {};
  storedPhotos.forEach((p) => {
    const key = getGroupKey(p);
    if (!photoGroups[key]) photoGroups[key] = [];
    photoGroups[key].push(p);
  });

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-blue-50/40 px-4 pt-6 pb-28">
      <div className="max-w-2xl mx-auto">

        {/* ── Hero header ── */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100 via-sky-50 to-blue-100 border border-sky-200/60 p-6 mb-5 shadow-sm">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-sky-200/50 rounded-full blur-2xl" />
          <div className="absolute -bottom-6 -left-6 w-28 h-28 bg-blue-200/40 rounded-full blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 bg-gradient-to-br from-sky-400 to-blue-500 rounded-2xl flex items-center justify-center shadow-md shadow-blue-200">
                <Scan size={20} className="text-white" />
              </div>
              <div className="flex-1">
                <h1 className="text-2xl font-black text-slate-800 tracking-tight leading-none">Faces</h1>
                <p className="text-slate-500 text-xs mt-0.5">AI-powered face detection & clustering</p>
              </div>
              {storedPhotos.length > 0 && (
                <button
                  onClick={() => setConfirmClearAll(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-red-500 text-xs font-bold rounded-xl transition-all border border-red-100 hover:bg-red-50"
                >
                  <Trash2 size={12} /> Clear All
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "People",  value: loading ? "—" : clusters.length,        icon: Users     },
                { label: "Faces",   value: loading ? "—" : totalFaces,             icon: Eye       },
                { label: "Photos",  value: loading ? "—" : storedPhotos.length,    icon: ImageIcon },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="bg-white/80 border border-white rounded-2xl p-3 text-center backdrop-blur-sm shadow-sm">
                  <Icon size={14} className="text-sky-500 mx-auto mb-1" />
                  <p className="text-xl font-black text-slate-800 leading-none">{value}</p>
                  <p className="text-slate-500 text-[10px] font-semibold mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {loading ? <FacesSkeleton /> : storedPhotos.length === 0 ? (

          /* ── Empty state ── */
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-14 text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-sky-100 to-blue-100 rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-inner">
              <Users size={32} className="text-blue-300" />
            </div>
            <p className="font-black text-slate-700 text-lg mb-1">No face photos yet</p>
            <p className="text-slate-400 text-sm leading-relaxed">
              Upload photos from the home screen.<br />
              Photos with detected faces appear here.
            </p>
          </div>

        ) : (
          <>
            {/* ── Tab switcher ── */}
            <div className="flex gap-1.5 mb-5 bg-white rounded-2xl p-1.5 border border-slate-100 shadow-sm">
              {([
                { key: "people", label: "By Person", icon: Users,     count: clusters.length },
                { key: "photos", label: "By Photo",  icon: ImageIcon, count: storedPhotos.length },
              ] as const).map(({ key, label, icon: Icon, count }) => (
                <button key={key} onClick={() => setActiveTab(key)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    activeTab === key
                      ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-blue-200"
                      : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                  }`}>
                  <Icon size={14} />
                  {label}
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                    activeTab === key ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                  }`}>{count}</span>
                </button>
              ))}
            </div>

            {/* ── By Person tab ── */}
            {activeTab === "people" && (
              <div>
                {!hasDescriptors ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle size={16} className="text-amber-600" />
                      <p className="font-bold text-amber-800 text-sm">Enhanced model required</p>
                    </div>
                    <p className="text-sm text-amber-700 leading-relaxed mb-3">
                      SSD + Face Recognition model files are required for person-based clustering.
                    </p>
                    <div className="bg-slate-900 rounded-xl px-4 py-3 flex items-center gap-2">
                      <Terminal size={14} className="text-emerald-400 flex-shrink-0" />
                      <code className="text-emerald-400 text-sm">bash _scripts/download-models.sh</code>
                    </div>
                  </div>
                ) : (
                  <>
                    {clusters.length === 0 ? (
                      <p className="text-center text-slate-400 py-12 text-sm">No faces detected yet. Upload photos with people to see clusters.</p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {clusters.map((cluster, idx) => {
                          const color = PALETTE[idx % PALETTE.length];
                          const rep = cluster.faces[0];
                          const repBox = rep?.photo.boxes?.[rep.boxIndex];
                          const displayLabel = labelOf(cluster);
                          const isEditing = editingId === cluster.id;
                          return (
                            <div key={cluster.id}
                              onClick={() => { if (!isEditing) setSelectedCluster({ cluster: { ...cluster, label: displayLabel }, idx }); }}
                              className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-[0.97] transition-all cursor-pointer p-4 text-center group">
                              <div className="flex justify-center mb-3">
                                {repBox ? (
                                  <FaceChip imageUrl={rep.photo.imageUrl} box={repBox} index={rep.boxIndex}
                                    size={72} ringClass={color.ring} />
                                ) : (
                                  <div className="w-[72px] h-[72px] rounded-full bg-slate-100 flex items-center justify-center ring-2 ring-offset-2 ring-slate-200">
                                    <Users size={24} className="text-slate-300" />
                                  </div>
                                )}
                              </div>
                              {isEditing ? (
                                <div className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    autoFocus
                                    value={editDraft}
                                    onChange={(e) => setEditDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") commitRename(cluster);
                                      if (e.key === "Escape") setEditingId(null);
                                    }}
                                    className="flex-1 text-xs font-bold text-slate-800 border border-blue-300 rounded-lg px-2 py-1 outline-none text-center min-w-0"
                                  />
                                  <button
                                    onClick={(e) => { e.stopPropagation(); commitRename(cluster); }}
                                    className="w-6 h-6 flex items-center justify-center bg-blue-500 rounded-lg text-white flex-shrink-0">
                                    <Check size={12} />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                                  <p className="font-black text-slate-800 text-sm">{displayLabel}</p>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setEditDraft(displayLabel); setEditingId(cluster.id); }}
                                    className="w-5 h-5 flex items-center justify-center rounded-full bg-blue-50 text-blue-500 hover:bg-blue-100 hover:text-blue-600 transition-colors">
                                    <Pencil size={10} />
                                  </button>
                                </div>
                              )}
                              <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mt-1.5 ${color.bg} ${color.text}`}>
                                {cluster.faces.length} appearance{cluster.faces.length !== 1 ? "s" : ""}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const names = [...new Set(cluster.faces.map(f => f.photo.fileName))].join(",");
                                  router.push(`/albums?faceNames=${encodeURIComponent(names)}&personLabel=${encodeURIComponent(displayLabel)}`);
                                }}
                                className="mt-1.5 w-full flex items-center justify-center gap-1 text-[10px] font-bold text-blue-500 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-full transition-colors"
                              >
                                <Images size={9} /> See in Albums
                              </button>
                              {clusters.length > 1 && (
                                <select
                                  value=""
                                  disabled={merging === cluster.id}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    const targetId = e.target.value;
                                    e.target.value = "";
                                    const target = clusters.find((c) => c.id === targetId);
                                    if (target) handleMerge(cluster, target);
                                  }}
                                  className="mt-1.5 w-full text-[10px] font-bold text-slate-400 bg-slate-50 hover:bg-slate-100 disabled:opacity-50 px-2 py-1 rounded-full border border-slate-100 outline-none appearance-none text-center"
                                >
                                  <option value="">{merging === cluster.id ? "Merging…" : "🔗 Merge with…"}</option>
                                  {clusters.filter((c) => c.id !== cluster.id).map((c) => (
                                    <option key={c.id} value={c.id}>{labelOf(c)}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── By Photo tab ── */}
            {activeTab === "photos" && (
              <div className="space-y-6">
                {Object.entries(photoGroups).map(([groupKey, photos]) => (
                  <div key={groupKey}>
                    {/* Group header */}
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${photos[0]?.location ? "bg-blue-100" : "bg-slate-100"}`}>
                        {photos[0]?.location
                          ? <MapPin size={12} className="text-blue-500" />
                          : <CalendarDays size={12} className="text-slate-400" />}
                      </div>
                      <h3 className="font-black text-slate-800 text-sm flex-1 truncate">{groupKey}</h3>
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        {photos.length}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {photos.map((photo) => (
                        <div key={photo.id}
                          onClick={() => setSelectedPhoto(photo)}
                          className="bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-[0.97] transition-all cursor-pointer group relative">

                          {/* Image */}
                          <div className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={photo.imageUrl} alt={photo.fileName}
                              className="w-full h-44 object-cover bg-slate-100" />

                            {/* Face count badge */}
                            <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-1 rounded-full">
                              <Users size={9} /> {photo.faceCount}
                            </div>

                            {/* Expression badge */}
                            {photo.expressions?.[0] && photo.expressions[0] !== "neutral" && (
                              <div className="absolute top-2 right-10 bg-black/60 backdrop-blur-sm text-sm px-1.5 py-0.5 rounded-full">
                                {EXPRESSION_EMOJI[photo.expressions[0]]}
                              </div>
                            )}

                            {/* Delete */}
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(photo.id); }}
                              className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all">
                              <Trash2 size={12} />
                            </button>

                            {/* Age / gender bottom-left — 0 means "unknown" (a MediaPipe-localized
                                face face-api couldn't extract age/gender for), not a real age */}
                            {photo.ages?.[0] != null && photo.ages[0] > 0 && (
                              <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                                {photo.genders?.[0] === "male" ? "♂" : "♀"} {photo.ages[0]}yr
                              </div>
                            )}

                            {/* Descriptor dot */}
                            {photo.descriptors?.length && (
                              <div className="absolute bottom-2 right-2 w-2 h-2 bg-emerald-400 rounded-full shadow" title="Has face recognition data" />
                            )}
                          </div>

                          {/* Info strip */}
                          <div className="px-3 py-2.5">
                            <p className="font-bold text-slate-800 text-xs truncate leading-snug">{photo.fileName}</p>
                            {photo.location ? (
                              <p className="text-[10px] text-slate-400 flex items-center gap-0.5 mt-1 truncate">
                                <MapPin size={8} className="flex-shrink-0" />
                                {photo.location.split(",")[0]}
                              </p>
                            ) : (
                              <p className="text-[10px] text-slate-300 mt-1">{photo.uploadedAt.slice(0, 10)}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {selectedPhoto && (
          <PhotoModal photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} onDelete={handleDelete} onRemoveFace={handleRemoveFace} />
        )}
        {selectedCluster && (
          <PersonModal
            cluster={selectedCluster.cluster}
            colorIdx={selectedCluster.idx}
            onClose={() => setSelectedCluster(null)}
            onRemoveFace={handleRemoveFace}
          />
        )}
      </div>
      <BottomNav />

      {/* ── Clear All confirm modal ── */}
      {confirmClearAll && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[3000] flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={26} className="text-red-500" />
            </div>
            <h3 className="text-lg font-extrabold text-slate-900 mb-1">Clear all face data?</h3>
            <p className="text-sm text-slate-500 mb-5">All face recognition data and photos will be deleted. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmClearAll(false)}
                className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 transition-colors">
                Back
              </button>
              <button onClick={handleClearAll}
                className="flex-1 py-3 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm transition-colors">
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Single photo confirm modal ── */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[3000] flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={26} className="text-red-500" />
            </div>
            <h3 className="text-lg font-extrabold text-slate-900 mb-1">Delete this photo?</h3>
            <p className="text-sm text-slate-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 transition-colors">
                Back
              </button>
              <button onClick={() => handleDelete(confirmDeleteId)}
                className="flex-1 py-3 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
