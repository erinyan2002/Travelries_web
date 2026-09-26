"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import PageHero from "@/components/PageHero";
import ActionMenu from "@/components/ActionMenu";
import Avatar from "@/components/Avatar";
import FaceChip from "@/components/FaceChip";
import { getSessionUser } from "@/lib/supabase";
import { FacePhoto } from "@/lib/types";
import { fetchFacePhotos, fetchMapPhotos, updateFacePersonIds, removeFaceFromPhoto } from "@/lib/photosApi";
import { detectTrips, Trip } from "@/lib/trips";
import { deletePhotoEverywhere } from "@/lib/savedUtils";
import { fetchPeople, createPerson, renamePerson, linkPersonToUser, Person } from "@/lib/peopleApi";
import { fetchFollowingProfiles, fetchFollowerProfiles, Profile } from "@/lib/socialUtils";
import { FaceEntry, PersonCluster, MATCH_THRESHOLD, buildPersonGroups } from "@/lib/faceClustering";
import { nestedDuplicateIndices } from "@/lib/faceMatching";
import { useRouter } from "next/navigation";
import {
  Users, ImageIcon, Images, MapPin, CalendarDays, Trash2, X,
  Terminal, AlertTriangle, Eye, Scan, Pencil, Check, Plane, Combine, UserPlus, UserCheck, Loader2, ShieldCheck,
} from "lucide-react";
import Link from "next/link";



// Canvas stroke colours, index-aligned with PALETTE's ring colours (blue-*/indigo-*
// are remapped to sky shades in globals.css, so these are sky hexes).
const BOX_COLORS = ["#a78bfa", "#38bdf8", "#34d399", "#fbbf24", "#fb7185", "#0ea5e9", "#f472b6", "#22d3ee"];

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

// Writes one person_id onto every given face, batched per photo row and keeping
// any other face's existing tag on the same row. Shared by merge, rename and the
// one-time localStorage-label migration.
async function assignPersonToFaces(uid: string, faces: FaceEntry[], personId: string): Promise<void> {
  const updates = new Map<string, { photo: FacePhoto; indices: number[] }>();
  for (const face of faces) {
    const entry = updates.get(face.photo.id) ?? { photo: face.photo, indices: [] };
    entry.indices.push(face.boxIndex);
    updates.set(face.photo.id, entry);
  }
  for (const { photo, indices } of updates.values()) {
    const current = photo.personIds ? [...photo.personIds] : new Array(photo.boxes?.length ?? 0).fill(null);
    indices.forEach((i) => { current[i] = personId; });
    await updateFacePersonIds(uid, photo.id, photo.fileName, photo.imageUrl, current);
  }
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
      // Thin outline + a small number badge per face, in the same colour as that
      // face's chip below (the number is how you tell which chip to remove).
      // It used to be a thick bar over the face with the confidence as its colour
      // and an expression emoji, which hid the faces and meant nothing to users.
      const unit = Math.max(img.width, img.height) / 100;
      const lineW = Math.max(2, unit * 0.45);
      const r = Math.max(11, unit * 1.9);
      photo.boxes.forEach((box, i) => {
        if (isFaceRemoved(photo, i)) return;
        const x = box.x * img.width, y = box.y * img.height;
        const w = box.width * img.width, h = box.height * img.height;
        const color = BOX_COLORS[i % BOX_COLORS.length];
        ctx.strokeStyle = color; ctx.lineWidth = lineW;
        ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = lineW * 2;
        ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.08); ctx.stroke();
        ctx.shadowBlur = 0;
        const cx = x + r * 0.9, cy = y + r * 0.9;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = `bold ${r * 1.1}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), cx, cy + r * 0.05);
      });
    };
  }, [photo]);
  return <canvas ref={canvasRef} className="w-full h-auto block" />;
}

// ── Modals ────────────────────────────────────────────────────────────────────
function PhotoModal({ photo, onClose, onDelete, onRemoveFace }: {
  photo: FacePhoto; onClose: () => void; onDelete: (id: string) => void;
  onRemoveFace: (photoId: string, boxIndex: number) => void;
}) {
  // Counted from the boxes shown, not face_count: that column can lag behind
  // (e.g. Save to Map wrote 0 before the face save finished).
  const shownFaces = (photo.boxes ?? []).filter((_, i) => !isFaceRemoved(photo, i)).length;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[3000] flex items-end sm:items-center justify-center sm:p-5 overflow-y-auto" onClick={onClose}>
      <div className="w-full sm:max-w-[600px] bg-white sm:rounded-3xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="bg-gradient-to-r from-sky-500 to-blue-600 px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-white text-sm truncate max-w-[260px]">{photo.fileName}</h3>
            <p className="text-sky-100 text-xs mt-0.5 flex items-center gap-1.5">
              <Users size={10} /> {shownFaces} {shownFaces === 1 ? "face" : "faces"}
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
              Detected faces ({shownFaces})
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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[3000] flex items-end sm:items-center justify-center sm:p-5 overflow-y-auto" onClick={onClose}>
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
  const [editingId,       setEditingId]       = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editDraft,       setEditDraft]       = useState("");
  const [uid,             setUid]             = useState<string | null>(null);
  const [people,          setPeople]          = useState<Person[]>([]);
  const [merging,         setMerging]         = useState<string | null>(null);
  const [friends,         setFriends]         = useState<Profile[]>([]);
  // All trips, to show "N trips" per person (a trip counts if the person is in any of its photos).
  const [trips,           setTrips]           = useState<Trip[]>([]);
  const router = useRouter();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await getSessionUser();
      const u = user?.id ?? "guest";
      setUid(u);

      let faces = u === "guest" ? [] : await fetchFacePhotos(u);
      let peopleList = u === "guest" ? [] : await fetchPeople(u);

      // One-time migration: names given to auto-clusters used to live only in this
      // browser's localStorage (lost on another device). Turn each still-matching
      // one into a real `people` row + person_ids tags, then drop the old map.
      if (u !== "guest") {
        const key = `face-labels-${u}`;
        let rawLabels: Record<string, string> = {};
        try { rawLabels = JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { /* corrupt — ignore */ }
        const entries = Object.entries(rawLabels).filter(([k, v]) => !k.match(/^p\d+$/) && v?.trim());
        if (entries.length > 0) {
          try {
            const autoClusters = buildPersonGroups(faces, peopleList, MATCH_THRESHOLD).filter((c) => !c.personId);
            for (const [clusterId, name] of entries) {
              const cluster = autoClusters.find((c) => c.id === clusterId);
              if (!cluster) continue; // cluster no longer exists — label is stale
              const created = await createPerson(u, name.trim());
              await assignPersonToFaces(u, cluster.faces, created.id);
            }
            localStorage.removeItem(key);
            [faces, peopleList] = await Promise.all([fetchFacePhotos(u), fetchPeople(u)]);
          } catch (err) {
            // Leave the localStorage map in place so the next load retries.
            console.error("Migrating face labels failed:", err);
          }
        }
      }

      // One face saved as two nested boxes (an older detector bug, fixed at upload
      // time) — tombstone the inner box on already-saved photos so the demo data
      // doesn't show one person as two. Tagged faces are never touched.
      if (u !== "guest") {
        let cleaned = 0;
        for (const photo of faces) {
          for (const i of nestedDuplicateIndices(photo.boxes ?? [], photo.personIds)) {
            try { await removeFaceFromPhoto(u, photo.id, i); cleaned++; }
            catch (err) { console.warn("Removing duplicate face failed:", err); }
          }
        }
        if (cleaned > 0) faces = await fetchFacePhotos(u);
      }

      if (u !== "guest") {
        // Anyone you follow or who follows you can be linked to a person here.
        const [following, followers] = await Promise.all([fetchFollowingProfiles(u), fetchFollowerProfiles(u)]);
        const byId = new Map([...following, ...followers].map((p) => [p.id, p]));
        setFriends([...byId.values()].sort((a, b) => (a.name || "").localeCompare(b.name || "")));
      }

      setStoredPhotos(faces);
      if (u !== "guest") fetchMapPhotos(u).then((m) => setTrips(detectTrips(m))).catch(() => {});
      setPeople(peopleList);
      setLoading(false);
    }
    load();
  }, []);

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
    try {
      await deletePhotoEverywhere(id);
      setStoredPhotos((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      // Already gone (e.g. deleted in another tab) — just drop it locally.
      if (err instanceof Error && err.message === "Photo not found or already deleted") {
        setStoredPhotos((prev) => prev.filter((p) => p.id !== id));
      } else {
        console.error("Delete failed:", err);
        alert("Couldn't delete this photo. Please try again.");
      }
    } finally {
      setConfirmDeleteId(null);
    }
  }

  const clusters      = useMemo(() => buildPersonGroups(storedPhotos, people, MATCH_THRESHOLD), [storedPhotos, people]);
  const hasDescriptors = storedPhotos.some((p) => p.descriptors?.length);
  const totalFaces    = storedPhotos.reduce((s, p) => s + (p.faceCount ?? 0), 0);

  // Confirmed clusters are named from the `people` table; auto-clusters show their
  // "Person N" placeholder until renamed (which turns them into a confirmed person).
  function labelOf(cluster: PersonCluster): string {
    return cluster.label;
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
      // Naming an auto-cluster makes it a real person (synced across devices) and
      // pins its current faces to it, so the name can't drift to other faces if
      // clustering regroups later.
      if (!uid || name === cluster.label) return;
      try {
        const created = await createPerson(uid, name);
        await assignPersonToFaces(uid, cluster.faces, created.id);
        setPeople((prev) => [...prev, created]);
        setStoredPhotos(await fetchFacePhotos(uid));
      } catch (err) {
        console.error("Rename failed:", err);
        alert("Couldn't rename this person. Please try again.");
      }
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
      await assignPersonToFaces(uid, [...source.faces, ...target.faces], personId);
      setStoredPhotos(await fetchFacePhotos(uid));
    } catch (err) {
      console.error("Merge failed:", err);
      alert("Couldn't merge these people. Please try again.");
    } finally {
      setMerging(null);
    }
  }

  // Links a Person card to a friend's account so posting a photo with this face
  // suggests tagging them (see NewPostModal in app/feed/page.tsx). An auto-cluster
  // is first turned into a real person, named after the friend.
  async function handleLink(cluster: PersonCluster, userId: string | null) {
    if (!uid) return;
    try {
      let personId = cluster.personId;
      if (!personId) {
        if (!userId) return;
        const friend = friends.find((f) => f.id === userId);
        const created = await createPerson(uid, friend?.name || "Friend");
        await assignPersonToFaces(uid, cluster.faces, created.id);
        personId = created.id;
        setPeople((prev) => [...prev, created]);
        setStoredPhotos(await fetchFacePhotos(uid));
      }
      await linkPersonToUser(personId, userId);
      setPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, linkedUserId: userId } : p)));
    } catch (err) {
      console.error("Link failed:", err);
      alert("Couldn't link this person. If this keeps happening, run supabase/migrations/0012_people_linked_user.sql.");
    }
  }

  const photoGroups: Record<string, FacePhoto[]> = {};
  storedPhotos.forEach((p) => {
    const key = getGroupKey(p);
    if (!photoGroups[key]) photoGroups[key] = [];
    photoGroups[key].push(p);
  });

  return (
    <main className="min-h-screen px-4 pt-16 xl:pt-6 pb-24 lg:pb-10">
      <div className="max-w-2xl mx-auto">

        {/* ── Hero header ── */}
        <PageHero
          icon={Scan}
          title="People"
          subtitle="People in your memories, grouped by face recognition"
        >
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
        </PageHero>

        <Link href="/profile#face-analysis"
          className="flex items-center gap-2 -mt-3 mb-5 text-xs text-slate-500 bg-white/70 border border-white rounded-xl px-3 py-2 hover:bg-white transition-colors">
          <ShieldCheck size={14} className="text-emerald-500 flex-shrink-0" />
          <span>Face data is private to you and used only to organize your photos.</span>
          <span className="ml-auto font-bold text-blue-600 whitespace-nowrap">Privacy</span>
        </Link>

        {loading ? <FacesSkeleton /> : storedPhotos.length === 0 ? (

          /* ── Empty state ── */
          <div className="tv-card rounded-3xl p-14 text-center">
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
                              className="tv-card hover:shadow-md hover:-translate-y-0.5 active:scale-[0.97] transition-all cursor-pointer p-4 text-center group">
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
                                {(() => {
                                  const ids = new Set(cluster.faces.map((f) => f.photo.id));
                                  const tripCount = trips.filter((t) => t.photos.some((p) => ids.has(p.id))).length;
                                  return <>{ids.size} photo{ids.size !== 1 ? "s" : ""}{tripCount > 0 && <> · {tripCount} trip{tripCount !== 1 ? "s" : ""}</>}</>;
                                })()}
                              </span>
                              {(() => {
                                // By photo id, not filename — names like IMG_1234.jpg repeat.
                                const albumsUrl = (view?: string) => {
                                  const ids = [...new Set(cluster.faces.map((f) => f.photo.id))].join(",");
                                  return `/albums?photoIds=${encodeURIComponent(ids)}&personLabel=${encodeURIComponent(displayLabel)}${view ? `&view=${view}` : ""}`;
                                };
                                const linkedId = people.find((p) => p.id === cluster.personId)?.linkedUserId ?? null;
                                const linked = friends.find((f) => f.id === linkedId);
                                const chip = "w-full flex items-center justify-center gap-1 text-[11px] font-bold px-2 py-1.5 rounded-full transition-colors";
                                return (
                                  <div className="mt-3 grid grid-cols-2 gap-1.5">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); router.push(albumsUrl()); }}
                                      className={`${chip} text-sky-700 bg-sky-50 hover:bg-sky-100`}
                                    >
                                      <Images size={12} /> Photos
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); router.push(albumsUrl("trips")); }}
                                      className={`${chip} text-indigo-600 bg-indigo-50 hover:bg-indigo-100`}
                                    >
                                      <Plane size={12} /> Trips
                                    </button>
                                    <ActionMenu
                                      icon={merging === cluster.id ? <Loader2 size={12} className="animate-spin" /> : <Combine size={12} />}
                                      label={merging === cluster.id ? "Merging…" : "Merge"}
                                      title="Same person as…"
                                      disabled={clusters.length < 2 || merging === cluster.id}
                                      emptyText="No other people yet"
                                      options={clusters.filter((c) => c.id !== cluster.id).map((c) => {
                                        const r = c.faces[0];
                                        const b = r?.photo.boxes?.[r.boxIndex];
                                        return {
                                          value: c.id,
                                          label: labelOf(c),
                                          leading: r && b
                                            ? <FaceChip imageUrl={r.photo.imageUrl} box={b} index={r.boxIndex} size={26} ringClass="ring-slate-200" />
                                            : <span className="w-[26px] h-[26px] rounded-full bg-slate-100 flex-shrink-0" />,
                                        };
                                      })}
                                      onSelect={(id) => {
                                        const target = clusters.find((c) => c.id === id);
                                        if (target) handleMerge(cluster, target);
                                      }}
                                    />
                                    <ActionMenu
                                      icon={linked ? <UserCheck size={12} /> : <UserPlus size={12} />}
                                      label={linked ? (linked.name || "Linked") : "Account"}
                                      title="Link to a friend's account"
                                      tone={linked ? "emerald" : "slate"}
                                      disabled={friends.length === 0}
                                      emptyText="Follow someone to link them"
                                      options={[
                                        ...friends.map((f) => ({
                                          value: f.id,
                                          label: f.name || "Traveler",
                                          leading: <Avatar name={f.name || "Traveler"} url={f.avatar_url} size="sm" />,
                                          selected: f.id === linkedId,
                                        })),
                                        ...(linked ? [{ value: "", label: "Unlink account", danger: true }] : []),
                                      ]}
                                      onSelect={(id) => { if (id !== linkedId) handleLink(cluster, id || null); }}
                                    />
                                  </div>
                                );
                              })()}
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

                            {/* Delete */}
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(photo.id); }}
                              className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all">
                              <Trash2 size={12} />
                            </button>

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


      {/* ── Single photo confirm modal ── */}
      {confirmDeleteId && (
        <div className="fixed inset-0 tv-overlay z-[3000] flex items-center justify-center p-6">
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
