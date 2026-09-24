"use client";

import { useEffect, useMemo, useState } from "react";
import BottomNav from "@/components/BottomNav";
import PageHero from "@/components/PageHero";
import { supabase } from "@/lib/supabase";
import { MapPhoto } from "@/lib/types";
import { fetchEveryPhoto } from "@/lib/photosApi";
import { deletePhotoEverywhere } from "@/lib/savedUtils";
import { loadImage } from "@/lib/canvasCard";
import { getPhotoDate } from "@/lib/trips";
import {
  AnalyzedPhoto, ANALYSIS_SIZE, DHASH_W, DHASH_H,
  toGrayscale, dHash, laplacianVariance, groupSimilar, findBlurry,
} from "@/lib/photoCleanup";
import { Wand2, Copy, Droplets, Trash2, Loader2, Check, CheckCircle2 } from "lucide-react";

function grayOf(img: HTMLImageElement, w: number, h: number): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return toGrayscale(ctx.getImageData(0, 0, w, h).data, w, h);
}

async function analyze(photo: MapPhoto): Promise<AnalyzedPhoto> {
  const img = await loadImage(photo.imageUrl);
  const scale = Math.min(1, ANALYSIS_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(3, Math.round(img.naturalWidth * scale));
  const h = Math.max(3, Math.round(img.naturalHeight * scale));
  const t = getPhotoDate(photo).getTime();
  return {
    id: photo.id,
    hash: dHash(grayOf(img, DHASH_W, DHASH_H)),
    sharpness: laplacianVariance(grayOf(img, w, h), w, h),
    // Only a real capture time counts — uploadedAt would make a whole batch
    // upload look "taken together".
    takenAt: photo.captureTimestamp && t > 0 ? t : null,
  };
}

// Suggests near-duplicate and blurry photos to delete. Everything is analyzed in
// the browser (lib/photoCleanup.ts); nothing is deleted without confirmation.
export default function CleanupPage() {
  const [photos,    setPhotos]    = useState<MapPhoto[]>([]);
  const [analyzed,  setAnalyzed]  = useState<AnalyzedPhoto[]>([]);
  const [progress,  setProgress]  = useState<{ done: number; total: number } | null>(null);
  const [failed,    setFailed]    = useState(0);
  const [selected,  setSelected]  = useState<Set<string>>(new Set());
  const [confirm,   setConfirm]   = useState(false);
  const [deleting,  setDeleting]  = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const all = await fetchEveryPhoto(user.id);
      if (cancelled) return;
      setPhotos(all);
      setProgress({ done: 0, total: all.length });
      const results: AnalyzedPhoto[] = [];
      let done = 0, fails = 0, next = 0;
      // A few at a time — each is a download + two canvas passes.
      const worker = async () => {
        while (next < all.length && !cancelled) {
          const p = all[next++];
          try { results.push(await analyze(p)); } catch { fails++; }
          done++;
          if (!cancelled) setProgress({ done, total: all.length });
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (cancelled) return;
      setAnalyzed(results);
      setFailed(fails);
      // Pre-select every non-best photo in each similar group.
      setSelected(new Set(groupSimilar(results).flatMap((g) => g.slice(1).map((p) => p.id))));
    })();
    return () => { cancelled = true; };
  }, []);

  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const groups = useMemo(() => groupSimilar(analyzed), [analyzed]);
  const blurry = useMemo(() => {
    const inGroups = new Set(groups.flat().map((p) => p.id));
    return findBlurry(analyzed).filter((p) => !inGroups.has(p.id));
  }, [analyzed, groups]);
  const analyzing = progress !== null && progress.done < progress.total;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleDelete() {
    setDeleting(true);
    const removed = new Set<string>();
    for (const id of selected) {
      try {
        await deletePhotoEverywhere(id);
        removed.add(id);
      } catch (err) {
        if (err instanceof Error && err.message === "Photo not found or already deleted") removed.add(id);
        else console.error("Delete failed:", err);
      }
    }
    setAnalyzed((prev) => prev.filter((p) => !removed.has(p.id)));
    setPhotos((prev) => prev.filter((p) => !removed.has(p.id)));
    setSelected((prev) => new Set([...prev].filter((id) => !removed.has(id))));
    setDeleting(false);
    setConfirm(false);
    if (removed.size < selected.size) alert(`${selected.size - removed.size} photo(s) couldn't be deleted. Please try again.`);
  }

  // A plain render function, not a nested component — a component defined in
  // render is a new type every render, which remounts (and reloads) every image.
  const renderThumb = (a: AnalyzedPhoto, best = false) => {
    const photo = byId.get(a.id);
    if (!photo) return null;
    const isSel = selected.has(a.id);
    return (
      <button key={a.id} onClick={() => toggle(a.id)}
        className={`relative flex-shrink-0 w-28 rounded-xl overflow-hidden border-2 transition-all ${isSel ? "border-red-400" : best ? "border-emerald-400" : "border-transparent"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.imageUrl} alt={photo.fileName} className={`w-full h-28 object-cover ${isSel ? "opacity-60" : ""}`} />
        {best && !isSel && (
          <span className="absolute top-1 left-1 text-[9px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">Sharpest</span>
        )}
        <span className={`absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center ${isSel ? "bg-red-500 text-white" : "bg-white/80 text-transparent"}`}>
          <Check size={12} />
        </span>
        <p className="text-[10px] text-slate-500 truncate px-1.5 py-1 bg-white text-left">{photo.fileName}</p>
      </button>
    );
  };

  return (
    <main className="min-h-screen px-6 py-8 pb-40">
      <div className="max-w-5xl mx-auto">
        <PageHero icon={Wand2} title="Clean Up" subtitle="Find near-duplicate and blurry photos to tidy up." />

        {progress === null ? (
          <p className="text-sm text-slate-400 text-center py-12 animate-pulse">Loading photos…</p>
        ) : analyzing ? (
          <div className="tv-card p-6 text-center">
            <Loader2 size={22} className="animate-spin text-blue-500 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-700">Analyzing photos… {progress.done} / {progress.total}</p>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-3">
              <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </div>
          </div>
        ) : groups.length === 0 && blurry.length === 0 ? (
          <div className="tv-card p-8 text-center">
            <CheckCircle2 size={28} className="text-emerald-500 mx-auto mb-2" />
            <p className="font-bold text-slate-700">All tidy!</p>
            <p className="text-sm text-slate-400 mt-1">No near-duplicate or blurry photos found in {analyzed.length} photos.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.length > 0 && (
              <section>
                <h2 className="font-bold text-slate-800 flex items-center gap-2 mb-1"><Copy size={16} className="text-blue-500" /> Similar photos</h2>
                <p className="text-xs text-slate-400 mb-3">{groups.length} group{groups.length !== 1 ? "s" : ""} of near-identical shots. The sharpest is kept; tap to change what gets deleted.</p>
                <div className="space-y-3">
                  {groups.map((g) => (
                    <div key={g[0].id} className="tv-card p-3 flex gap-2 overflow-x-auto">
                      {g.map((a, i) => renderThumb(a, i === 0))}
                    </div>
                  ))}
                </div>
              </section>
            )}
            {blurry.length > 0 && (
              <section>
                <h2 className="font-bold text-slate-800 flex items-center gap-2 mb-1"><Droplets size={16} className="text-blue-500" /> Possibly blurry</h2>
                <p className="text-xs text-slate-400 mb-3">Low-detail photos: out of focus or shaken, or just a plain scene like sky or water. Check before deleting.</p>
                <div className="tv-card p-3 flex flex-wrap gap-2">
                  {blurry.map((a) => renderThumb(a))}
                </div>
              </section>
            )}
          </div>
        )}
        {failed > 0 && !analyzing && (
          <p className="text-xs text-slate-400 text-center mt-4">{failed} photo(s) couldn&apos;t be analyzed and were skipped.</p>
        )}
      </div>

      {selected.size > 0 && !analyzing && (
        <div className="fixed bottom-24 left-0 right-0 flex justify-center px-4 z-40">
          <button onClick={() => setConfirm(true)}
            className="flex items-center gap-2 px-5 py-3 bg-red-500 hover:bg-red-600 text-white font-bold text-sm rounded-2xl shadow-lg shadow-red-200 transition-colors">
            <Trash2 size={16} /> Delete {selected.size} photo{selected.size !== 1 ? "s" : ""}
          </button>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 tv-overlay z-[3000] flex items-center justify-center p-4" onClick={() => !deleting && setConfirm(false)}>
          <div className="tv-modal p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold text-slate-900 mb-1">Delete {selected.size} photo{selected.size !== 1 ? "s" : ""}?</p>
            <p className="text-sm text-slate-500 mb-5">They&apos;ll be removed from your map, albums and faces. This can&apos;t be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirm(false)} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 disabled:opacity-60">Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 disabled:opacity-60">
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
