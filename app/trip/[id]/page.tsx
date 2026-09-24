"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import Link from "next/link";
import { MapPin, CalendarDays, Images, Sparkles, X } from "lucide-react";
import AppLogo from "@/components/AppLogo";
import { getTripShare, TripShare, TripSharePhoto } from "@/lib/tripShareUtils";

const TripRouteMap = dynamic(() => import("@/components/TripRouteMap"), {
  ssr: false,
  loading: () => <div className="w-full h-64 rounded-2xl bg-slate-100 animate-pulse" />,
});

// Public (no login — see AuthGuard) page for a whole shared trip: route map,
// AI diary if one had been generated, and every photo in order.
export default function TripSharePage() {
  const { id } = useParams<{ id: string }>();
  const [share, setShare] = useState<TripShare | null | undefined>(undefined);
  const [open, setOpen] = useState<TripSharePhoto | null>(null);

  useEffect(() => {
    if (id) getTripShare(id).then(setShare);
  }, [id]);

  if (share === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!share) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4 opacity-40">
            <AppLogo size="lg" />
          </div>
          <p className="font-bold text-slate-700 mb-1">Trip not found</p>
          <p className="text-slate-400 text-sm mb-4">This link may have expired or been removed.</p>
          <Link href="/"
            className="inline-block px-4 py-2 bg-gradient-to-r from-sky-500 to-blue-600 text-white text-sm font-bold rounded-xl hover:bg-gradient-to-r from-sky-500 to-blue-600 transition-all">
            Open Travelries
          </Link>
        </div>
      </div>
    );
  }

  const points = share.photos
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({ lat: p.lat!, lng: p.lng! }));

  return (
    <main className="min-h-screen px-4 py-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <AppLogo size="sm" />
          <span className="text-sm font-bold text-slate-700">
            Travel<span className="bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent">ries</span>
          </span>
          <span className="text-slate-300 mx-1">·</span>
          <span className="text-xs text-slate-400">Shared trip</span>
        </div>

        <div className="rounded-3xl bg-gradient-to-br from-sky-100 via-sky-50 to-blue-100 border border-sky-200/60 p-6 mb-4 shadow-sm">
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <MapPin size={20} className="text-blue-500 flex-shrink-0" /> {share.title}
          </h1>
          <div className="flex flex-wrap gap-2 mt-3">
            {share.dateRange && (
              <span className="inline-flex items-center gap-1 text-xs font-bold bg-white/80 text-slate-600 px-2.5 py-1 rounded-full">
                <CalendarDays size={11} /> {share.dateRange}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs font-bold bg-white/80 text-slate-600 px-2.5 py-1 rounded-full">
              <Images size={11} /> {share.photos.length} photo{share.photos.length !== 1 ? "s" : ""}
            </span>
            {share.locations.length > 1 && (
              <span className="inline-flex items-center gap-1 text-xs font-bold bg-white/80 text-slate-600 px-2.5 py-1 rounded-full">
                <MapPin size={11} /> {share.locations.join(" · ")}
              </span>
            )}
          </div>
        </div>

        {points.length > 0 && (
          <div className="tv-card p-2 mb-4">
            <TripRouteMap points={points} />
          </div>
        )}

        {share.diary && (
          <div className="tv-card p-5 mb-4">
            <p className="text-xs font-bold text-blue-500 flex items-center gap-1 mb-2"><Sparkles size={12} /> Travel diary</p>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{share.diary}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 mb-6">
          {share.photos.map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={p.imageUrl} alt={p.fileName} onClick={() => setOpen(p)}
              className="w-full aspect-square object-cover rounded-xl cursor-pointer hover:opacity-90 transition-opacity bg-slate-100" />
          ))}
        </div>

        <div className="text-center pb-6">
          <Link href="/" className="text-xs text-blue-500 font-semibold hover:underline">Open Travelries →</Link>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/80 z-[3000] flex items-center justify-center p-4" onClick={() => setOpen(null)}>
          <div className="max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end mb-2">
              <button onClick={() => setOpen(null)} className="text-white/80 hover:text-white p-1"><X size={20} /></button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={open.imageUrl} alt={open.fileName} className="w-full max-h-[75vh] object-contain rounded-xl" />
            {(open.location || open.captureDate) && (
              <p className="text-white/80 text-xs mt-2 text-center">
                {[open.location?.split(",")[0], open.captureDate].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
