"use client";

import { useEffect, useState } from "react";
import BottomNav from "@/components/BottomNav";
import { supabase } from "@/lib/supabase";
import { MapPhoto, FacePhoto } from "@/lib/types";
import {
  BarChart2, Camera, Users, MapPin, Star,
  TrendingUp, Image, CalendarDays, Clock,
} from "lucide-react";

type Stats = {
  totalPhotos: number;
  totalFaces: number;
  totalFacePhotos: number;
  totalSaved: number;
  totalLocations: number;
  portraitCount: number;
  generalCount: number;
  topLocations: { name: string; count: number }[];
  recentPhotos: MapPhoto[];
  mostFacesPhoto: MapPhoto | null;
  totalFacesDetected: number;
};

function StatCard({
  icon: Icon, label, value, color, sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <p className="text-2xl font-extrabold text-slate-900">{value}</p>
      <p className="text-sm font-semibold text-slate-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function BarRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <span className="text-sm font-bold text-slate-900">{count}장 <span className="text-slate-400 font-normal">({pct}%)</span></span>
      </div>
      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id ?? "guest";

      const mapPhotos: MapPhoto[] = JSON.parse(localStorage.getItem(`map-${uid}`) ?? "[]");
      const facePhotos: FacePhoto[] = JSON.parse(localStorage.getItem(`faces-${uid}`) ?? "[]");
      const savedIds: string[] = JSON.parse(localStorage.getItem(`saved-${uid}`) ?? "[]");

      const portraitCount = mapPhotos.filter((p) => (p.faceCount ?? 0) > 0).length;
      const generalCount  = mapPhotos.filter((p) => (p.faceCount ?? 0) === 0).length;

      // unique locations
      const locationSet = new Set(
        mapPhotos.map((p) => p.location?.split(",")[0]?.trim()).filter(Boolean)
      );

      // top locations
      const locationCount: Record<string, number> = {};
      mapPhotos.forEach((p) => {
        const loc = p.location?.split(",")[0]?.trim();
        if (loc) locationCount[loc] = (locationCount[loc] ?? 0) + 1;
      });
      const topLocations = Object.entries(locationCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      // most faces in one map photo
      const mostFacesPhoto = mapPhotos.reduce<MapPhoto | null>((best, p) => {
        if ((p.faceCount ?? 0) > (best?.faceCount ?? 0)) return p;
        return best;
      }, null);

      // total faces detected across all face_photos
      const totalFacesDetected = facePhotos.reduce((sum, p) => sum + (p.faceCount ?? 0), 0);

      setStats({
        totalPhotos: mapPhotos.length,
        totalFaces: facePhotos.length,
        totalFacePhotos: facePhotos.length,
        totalSaved: savedIds.length,
        totalLocations: locationSet.size,
        portraitCount,
        generalCount,
        topLocations,
        recentPhotos: mapPhotos.slice(0, 6),
        mostFacesPhoto,
        totalFacesDetected,
      });
    }
    load();
  }, []);

  if (!stats) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-8 pb-28 flex items-center justify-center">
        <p className="text-slate-400">불러오는 중...</p>
        <BottomNav />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8 pb-28">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-md shadow-indigo-200">
            <BarChart2 size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Statistics</h1>
            <p className="text-slate-500 text-sm">내 사진 활동 요약</p>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard icon={Camera}   label="저장된 사진"     value={stats.totalPhotos}         color="bg-blue-500"   sub="지도에 저장됨" />
          <StatCard icon={Users}    label="얼굴 사진"       value={stats.totalFacePhotos}     color="bg-rose-500"   sub={`${stats.totalFacesDetected}명 감지`} />
          <StatCard icon={MapPin}   label="방문한 장소"     value={stats.totalLocations}      color="bg-emerald-500" sub="고유 위치" />
          <StatCard icon={Star}     label="즐겨찾기"        value={stats.totalSaved}          color="bg-amber-400"  sub="저장된 사진" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

          {/* Photo type breakdown */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-5">
              <TrendingUp size={17} className="text-indigo-500" />
              <h2 className="font-bold text-slate-800">사진 분류</h2>
            </div>
            {stats.totalPhotos === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">저장된 사진이 없습니다</p>
            ) : (
              <div className="space-y-4">
                <BarRow label="인물 사진" count={stats.portraitCount} total={stats.totalPhotos} color="bg-blue-500" />
                <BarRow label="일반 사진" count={stats.generalCount}  total={stats.totalPhotos} color="bg-slate-400" />
                <div className="pt-2 border-t border-slate-100 flex justify-between text-xs text-slate-400">
                  <span>전체 {stats.totalPhotos}장</span>
                  {stats.mostFacesPhoto && (
                    <span>최다 얼굴: {stats.mostFacesPhoto.faceCount}명</span>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Top locations */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-5">
              <MapPin size={17} className="text-emerald-500" />
              <h2 className="font-bold text-slate-800">많이 간 장소 Top 5</h2>
            </div>
            {stats.topLocations.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">위치 정보가 있는 사진이 없습니다</p>
            ) : (
              <div className="space-y-3">
                {stats.topLocations.map((loc, i) => (
                  <div key={loc.name} className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-extrabold flex-shrink-0 ${
                      i === 0 ? "bg-amber-400 text-white" :
                      i === 1 ? "bg-slate-300 text-slate-700" :
                      i === 2 ? "bg-orange-300 text-white" : "bg-slate-100 text-slate-500"
                    }`}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-semibold text-slate-700 truncate">{loc.name}</span>
                        <span className="text-xs text-slate-400 ml-2 flex-shrink-0">{loc.count}장</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full"
                          style={{ width: `${Math.round((loc.count / stats.topLocations[0].count) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Recent uploads */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 bg-slate-50">
            <Clock size={16} className="text-slate-400" />
            <h2 className="font-bold text-slate-800">최근 업로드</h2>
            <span className="text-xs text-slate-400 bg-slate-200 px-2 py-0.5 rounded-full ml-auto">
              최근 {stats.recentPhotos.length}장
            </span>
          </div>
          {stats.recentPhotos.length === 0 ? (
            <div className="p-10 text-center">
              <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Image size={24} className="text-slate-300" />
              </div>
              <p className="text-slate-400 text-sm">아직 저장된 사진이 없습니다</p>
            </div>
          ) : (
            <div className="p-4 grid grid-cols-3 sm:grid-cols-6 gap-3">
              {stats.recentPhotos.map((photo) => (
                <div key={photo.id} className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.imageUrl} alt={photo.fileName} className="w-full h-20 object-contain bg-slate-100" />
                  <div className="p-1.5">
                    <p className="text-[9px] font-bold text-slate-700 truncate">{photo.fileName}</p>
                    <p className="text-[9px] text-slate-400 flex items-center gap-0.5 mt-0.5">
                      <CalendarDays size={7} />
                      {photo.captureDate ?? photo.uploadedAt?.slice(0, 10) ?? ""}
                    </p>
                    {(photo.faceCount ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[8px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full mt-1">
                        <Users size={7} /> {photo.faceCount}명
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
      <BottomNav />
    </main>
  );
}
