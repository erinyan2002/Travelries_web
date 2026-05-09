"use client";

import { useEffect, useMemo, useState } from "react";
import BottomNav from "@/components/BottomNav";
import { toggleSaved, getSavedIds } from "@/lib/savedUtils";
import { supabase } from "@/lib/supabase";
import { MapPhoto } from "@/lib/types";
import {
  Images, MapPin, Users, Image, Star, Download, Trash2,
  X, CalendarDays, SlidersHorizontal, Search, Calendar,
} from "lucide-react";

type Filter    = "전체" | "인물 사진" | "일반 사진";
type DateRange = "all" | "week" | "month" | "year";

const FILTERS: Filter[] = ["전체", "인물 사진", "일반 사진"];
const filterIcons: Record<Filter, React.ElementType> = {
  "전체": SlidersHorizontal, "인물 사진": Users, "일반 사진": Image,
};

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "all",   label: "전체 기간" },
  { value: "week",  label: "이번 주"   },
  { value: "month", label: "이번 달"   },
  { value: "year",  label: "이번 년도" },
];

function isInDateRange(photo: MapPhoto, range: DateRange): boolean {
  if (range === "all") return true;
  const raw = photo.uploadedAt;
  if (!raw) return true;
  const date = new Date(raw);
  const now   = new Date();
  if (range === "week") {
    return date >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  if (range === "month") {
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }
  if (range === "year") {
    return date.getFullYear() === now.getFullYear();
  }
  return true;
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
      <p className="text-[10px] text-slate-400 font-medium mb-0.5">{label}</p>
      <p className="text-xs font-bold text-slate-700 break-all">{value}</p>
    </div>
  );
}

function PhotoModal({
  photo, onClose, onDelete, onDownload,
}: {
  photo: MapPhoto; onClose: () => void;
  onDelete: (id: string) => void; onDownload: (photo: MapPhoto) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/85 z-[2000] flex items-center justify-center p-5" onClick={onClose}>
      <div className="max-w-[520px] w-full bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="min-w-0">
            <p className="font-bold text-slate-900 text-sm truncate">{photo.fileName}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {photo.location?.split(",")[0] || "위치 정보 없음"} · {photo.captureDate || photo.uploadedAt?.slice(0, 10) || ""}
            </p>
          </div>
          <button onClick={onClose} className="ml-4 text-slate-400 hover:text-slate-700 transition-colors p-1">
            <X size={20} />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.imageUrl} alt={photo.fileName} className="w-full max-h-[420px] object-contain bg-slate-100" />
        <div className="p-4 grid grid-cols-2 gap-2">
          {photo.captureDate && photo.captureDate !== "Not available" && <InfoChip label="촬영일" value={photo.captureDate} />}
          {photo.location && <div className="col-span-2"><InfoChip label="위치" value={photo.location} /></div>}
          <InfoChip label="AI 분류" value={(photo.faceCount ?? 0) > 0 ? `인물 사진 (${photo.faceCount}명)` : "일반 사진"} />
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-slate-100">
          <button onClick={() => onDownload(photo)}
            className="flex-1 flex items-center justify-center gap-2 bg-slate-900 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-slate-700 transition-colors">
            <Download size={15} /> 다운로드
          </button>
          <button onClick={() => { onDelete(photo.id); onClose(); }}
            className="flex-1 flex items-center justify-center gap-2 bg-red-500 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-red-600 transition-colors">
            <Trash2 size={15} /> 삭제
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AlbumsPage() {
  const [photos,        setPhotos]        = useState<MapPhoto[]>([]);
  const [filter,        setFilter]        = useState<Filter>("전체");
  const [dateRange,     setDateRange]     = useState<DateRange>("all");
  const [searchQuery,   setSearchQuery]   = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState<MapPhoto | null>(null);
  const [savedIds,      setSavedIds]      = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id ?? "guest";
      const stored: MapPhoto[] = JSON.parse(localStorage.getItem(`map-${uid}`) ?? "[]");
      setPhotos(stored);
      setSavedIds(await getSavedIds());
    }
    load();
  }, []);

  async function handleToggleSaved(e: React.MouseEvent, photo: MapPhoto) {
    e.stopPropagation();
    const nowSaved = await toggleSaved(photo.id);
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (nowSaved) next.add(photo.id); else next.delete(photo.id);
      return next;
    });
  }

  async function handleDelete(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    const uid = user?.id ?? "guest";
    const mapKey = `map-${uid}`;
    const stored: MapPhoto[] = JSON.parse(localStorage.getItem(mapKey) ?? "[]");
    localStorage.setItem(mapKey, JSON.stringify(stored.filter((p) => p.id !== id)));
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    if (selectedPhoto?.id === id) setSelectedPhoto(null);
  }

  function handleDownload(photo: MapPhoto) {
    const a = document.createElement("a");
    a.href = photo.imageUrl;
    a.download = photo.fileName;
    a.click();
  }

  function clearAllFilters() {
    setSearchQuery("");
    setFilter("전체");
    setDateRange("all");
  }

  const counts = useMemo(() => ({
    "전체":    photos.length,
    "인물 사진": photos.filter((p) => (p.faceCount ?? 0) > 0).length,
    "일반 사진": photos.filter((p) => (p.faceCount ?? 0) === 0).length,
  }), [photos]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return photos.filter((p) => {
      if (filter === "인물 사진" && (p.faceCount ?? 0) === 0) return false;
      if (filter === "일반 사진" && (p.faceCount ?? 0) > 0)  return false;
      if (!isInDateRange(p, dateRange)) return false;
      if (q) {
        const inName     = p.fileName.toLowerCase().includes(q);
        const inLocation = (p.location ?? "").toLowerCase().includes(q);
        if (!inName && !inLocation) return false;
      }
      return true;
    });
  }, [photos, filter, dateRange, searchQuery]);

  const grouped = useMemo(() => {
    const map = new Map<string, MapPhoto[]>();
    for (const photo of filtered) {
      const key = (photo.location || "위치 정보 없음").split(",")[0].trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(photo);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const isFiltering = searchQuery.trim() !== "" || filter !== "전체" || dateRange !== "all";

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8 pb-28">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-md shadow-violet-200">
            <Images size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Albums</h1>
            <p className="text-slate-500 text-sm">지도에 저장된 사진을 위치별로 묶어서 보여줍니다.</p>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative mb-4">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="파일명 또는 위치로 검색..."
            className="w-full pl-10 pr-10 py-3 rounded-2xl border border-slate-200 bg-white text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition-all shadow-sm"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors p-1">
              <X size={15} />
            </button>
          )}
        </div>

        {/* Category filter chips */}
        <div className="flex gap-2 flex-wrap mb-3">
          {FILTERS.map((f) => {
            const active = filter === f;
            const Icon = filterIcons[f];
            return (
              <button key={f} onClick={() => setFilter(f)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                  active ? "bg-blue-600 text-white shadow-lg shadow-blue-200" : "bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                }`}>
                <Icon size={14} />
                {f}
                <span className={`ml-0.5 text-xs ${active ? "text-blue-100" : "text-slate-400"}`}>{counts[f]}</span>
              </button>
            );
          })}
        </div>

        {/* Date range chips */}
        <div className="flex gap-2 flex-wrap mb-5">
          {DATE_RANGES.map(({ value, label }) => {
            const active = dateRange === value;
            return (
              <button key={value} onClick={() => setDateRange(value)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  active ? "bg-violet-600 text-white shadow-lg shadow-violet-200" : "bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                }`}>
                <Calendar size={12} />
                {label}
              </button>
            );
          })}
        </div>

        {/* Result count + clear */}
        {photos.length > 0 && (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-400">
              {isFiltering
                ? <><strong className="text-slate-700">{filtered.length}</strong>장 검색됨 (전체 {photos.length}장)</>
                : <><strong className="text-slate-700">{photos.length}</strong>장</>
              }
            </p>
            {isFiltering && (
              <button onClick={clearAllFilters}
                className="flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-800 transition-colors">
                <X size={12} /> 필터 초기화
              </button>
            )}
          </div>
        )}

        {/* Grid or empty state */}
        {grouped.length === 0 ? (
          <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-16 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              {isFiltering
                ? <Search size={28} className="text-slate-300" />
                : <Images size={28} className="text-slate-300" />
              }
            </div>
            <p className="font-bold text-slate-700 mb-1">
              {isFiltering ? "검색 결과가 없습니다" : filter === "전체" ? "아직 저장된 사진이 없습니다" : `${filter}이 없습니다`}
            </p>
            <p className="text-slate-400 text-sm">
              {isFiltering
                ? <button onClick={clearAllFilters} className="text-violet-500 font-semibold hover:underline">필터를 초기화</button>
                : "홈에서 사진을 업로드하고 지도에 저장해보세요."
              }
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map(([groupName, items]) => (
              <section key={groupName} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 bg-slate-50">
                  <MapPin size={16} className="text-blue-500 flex-shrink-0" />
                  <h2 className="font-bold text-slate-800 text-base flex-1">{groupName}</h2>
                  <span className="text-xs text-slate-400 bg-slate-200 px-2 py-0.5 rounded-full">{items.length}장</span>
                </div>
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {items.map((photo) => {
                    const isPortrait = (photo.faceCount ?? 0) > 0;
                    return (
                      <div key={photo.id} onClick={() => setSelectedPhoto(photo)}
                        className="photo-card rounded-xl overflow-hidden border border-slate-200 bg-slate-50 cursor-pointer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.imageUrl} alt={photo.fileName} className="w-full h-36 object-contain bg-slate-100" />
                        <div className="p-2.5">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full mb-1.5 ${
                            isPortrait ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                          }`}>
                            {isPortrait ? <Users size={9} /> : <Image size={9} />}
                            {isPortrait ? "인물" : "일반"}
                          </span>
                          <p className="font-bold text-slate-800 text-xs truncate">{photo.fileName}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                            <CalendarDays size={9} />{photo.captureDate || "날짜 없음"}
                          </p>
                          <div className="flex gap-1.5 mt-2">
                            <button onClick={(e) => handleToggleSaved(e, photo)}
                              className={`flex-1 flex items-center justify-center py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                                savedIds.has(photo.id) ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                              }`}>
                              <Star size={11} className={savedIds.has(photo.id) ? "fill-amber-500" : ""} />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); handleDownload(photo); }}
                              className="flex-1 flex items-center justify-center py-1.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                              <Download size={11} />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(photo.id); }}
                              className="flex-1 flex items-center justify-center py-1.5 rounded-lg text-[10px] font-bold bg-red-50 text-red-500 hover:bg-red-100 transition-colors">
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {selectedPhoto && (
        <PhotoModal photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} onDelete={handleDelete} onDownload={handleDownload} />
      )}
      <BottomNav />
    </main>
  );
}
