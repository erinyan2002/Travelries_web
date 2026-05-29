"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getShare, ShareRecord } from "@/lib/shareUtils";
import { recordShareView } from "@/lib/notificationUtils";
import { MapPin, CalendarDays, Users } from "lucide-react";
import AppLogo from "@/components/AppLogo";

export default function SharePage() {
  const { id } = useParams<{ id: string }>();
  const [share, setShare] = useState<ShareRecord | null | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    getShare(id).then((s) => {
      setShare(s);
      if (s) recordShareView(id);
    });
  }, [id]);

  if (share === undefined) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!share) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4 opacity-40">
            <AppLogo size="lg" />
          </div>
          <p className="font-bold text-slate-700 mb-1">Photo not found</p>
          <p className="text-slate-400 text-sm mb-4">This link may have expired or been removed.</p>
          <Link href="/"
            className="inline-block px-4 py-2 bg-blue-500 text-white text-sm font-bold rounded-xl hover:bg-blue-600 transition-colors">
            Open Travelries
          </Link>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-[540px] w-full">
        <div className="flex items-center gap-2 mb-4">
          <AppLogo size="sm" />
          <span className="text-sm font-bold text-slate-700">
            Travel<span className="bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent">ries</span>
          </span>
          <span className="text-slate-300 mx-1">·</span>
          <span className="text-xs text-slate-400">Shared photo</span>
        </div>

        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="font-bold text-slate-900 truncate">{share.file_name}</p>
            {share.location && (
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                <MapPin size={10} /> {share.location.split(",")[0]}
              </p>
            )}
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={share.image_url}
            alt={share.file_name}
            className="w-full max-h-[480px] object-contain bg-slate-100"
          />

          <div className="p-4">
            <div className="grid grid-cols-2 gap-2">
              {share.capture_date && share.capture_date !== "Not available" && (
                <div className="bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                  <p className="text-[10px] text-slate-400 font-medium mb-0.5">Date taken</p>
                  <p className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <CalendarDays size={10} /> {share.capture_date}
                  </p>
                </div>
              )}
              {(share.face_count ?? 0) > 0 && (
                <div className="bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                  <p className="text-[10px] text-slate-400 font-medium mb-0.5">Faces detected</p>
                  <p className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <Users size={10} /> {share.face_count} {share.face_count === 1 ? "person" : "people"}
                  </p>
                </div>
              )}
              {share.location && (
                <div className="col-span-2 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                  <p className="text-[10px] text-slate-400 font-medium mb-0.5">Location</p>
                  <p className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <MapPin size={10} /> {share.location}
                  </p>
                </div>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 text-center">
              <Link href="/" className="text-xs text-blue-500 font-semibold hover:underline">
                Open Travelries →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
