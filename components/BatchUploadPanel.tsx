"use client";

import { motion } from "framer-motion";
import {
  Upload, MapPin, Users, CalendarDays, Clock, FileImage, Ruler,
  CheckCircle2, Loader2, AlertTriangle, Navigation, X, Check, Pencil,
} from "lucide-react";

export type BatchFile = {
  name: string;
  status: "pending" | "processing" | "done" | "error";
  info: string;
  photoId?: string;
  imageUrl?: string;
  faceCount?: number;
  fileSize?: string;
  location?: string;
  captureDate?: string;
  captureTime?: string;
  lat?: number;
  lng?: number;
  editName?: string;
};

// Home page multi-file upload panel: live per-file progress while processBatch()
// runs, then a review grid where each saved photo can be renamed.
export default function BatchUploadPanel({ items, onItemsChange, onRename, onClose }: {
  items: BatchFile[];
  onItemsChange: (items: BatchFile[]) => void;
  onRename: (photoId: string, newName: string) => void;
  onClose: () => void;
}) {
    const done  = items.filter((b) => b.status === "done" || b.status === "error").length;
    const total = items.length;
    const allDone = done === total && total > 0;
    const saved = items.filter((b) => b.status === "done").length;
    const totalFacesFound = items.reduce((sum, b) => sum + (b.status === "done" ? b.faceCount ?? 0 : 0), 0);
    return (
      <section className="tv-card overflow-hidden mb-6">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-200">
              <Upload size={16} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800">Batch Upload</h2>
              <p className="text-xs text-slate-400">{done} / {total} processed</p>
            </div>
          </div>
          {allDone && (
            <button onClick={onClose}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors">
              <X size={14} /> Close
            </button>
          )}
        </div>
        <div className="px-6 pt-4 pb-2">
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: total > 0 ? `${Math.round((done / total) * 100)}%` : "0%" }} />
          </div>
          <p className="text-xs text-slate-400 mt-1.5">{total > 0 ? Math.round((done / total) * 100) : 0}% complete</p>
        </div>
        {/* 처리 중: 간단한 목록 */}
        {!allDone && (
          <div className="px-6 pb-4 space-y-2 max-h-60 overflow-y-auto">
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                {item.status === "pending"    && <div className="w-5 h-5 rounded-full border-2 border-slate-300 flex-shrink-0" />}
                {item.status === "processing" && <Loader2 size={18} className="text-blue-500 animate-spin flex-shrink-0" />}
                {item.status === "done"       && <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />}
                {item.status === "error"      && <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{item.name}</p>
                  <p className={`text-xs mt-0.5 ${item.status === "error" ? "text-red-400" : "text-slate-400"}`}>
                    {item.info || (item.status === "pending" ? "Waiting..." : "Processing...")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 완료 후: 사진 카드 리뷰 */}
        {allDone && (
          <div className="px-6 pb-6">
            {/* 완료 배너 */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3 mb-4">
              <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-emerald-700">{saved} photo(s) saved!</p>
                {totalFacesFound > 0 && (
                  <p className="text-xs text-emerald-600 mt-0.5">{totalFacesFound} face(s) detected · tap a photo to rename</p>
                )}
              </div>
            </div>

            {/* 사진 카드 그리드 */}
            <div className="space-y-3">
              {/* Map the FULL list (skipping non-done items) so `i` is the item's real
                  index — rename writes items[i], and a filtered list's index pointed at
                  the wrong photo whenever an errored file came earlier in the batch. */}
              {items.map((item, i) => item.status === "done" && item.imageUrl && (
                <div key={i} className="flex gap-3 bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
                  {/* 썸네일 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.imageUrl} alt={item.name}
                    className="w-24 h-24 object-cover flex-shrink-0 bg-slate-200" />

                  {/* 정보 + 이름 변경 */}
                  <div className="flex-1 min-w-0 py-3 pr-3">
                    {/* 분석 뱃지들 */}
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {(item.faceCount ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                          <Users size={9} /> {item.faceCount} face{(item.faceCount ?? 0) > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                          <FileImage size={9} /> Scenery
                        </span>
                      )}
                      {item.captureDate && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                          <CalendarDays size={9} /> {item.captureDate}
                        </span>
                      )}
                      {item.captureTime && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                          <Clock size={9} /> {item.captureTime}
                        </span>
                      )}
                      {item.fileSize && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                          <Ruler size={9} /> {item.fileSize}
                        </span>
                      )}
                    </div>

                    {/* 위치 + 좌표 */}
                    {item.location && (
                      <p className="text-[10px] text-slate-400 flex items-center gap-1 mb-1 truncate">
                        <MapPin size={9} className="flex-shrink-0" />
                        {item.location.split(",")[0]}
                      </p>
                    )}
                    {item.lat !== undefined && item.lng !== undefined && (
                      <p className="text-[10px] text-slate-400 flex items-center gap-1 mb-2 truncate">
                        <Navigation size={9} className="flex-shrink-0" />
                        {item.lat.toFixed(6)}, {item.lng.toFixed(6)}
                      </p>
                    )}

                    {/* 이름 변경 인풋 + 확인 버튼 */}
                    <div className="flex gap-1.5">
                      <div className="relative flex-1 min-w-0">
                        <Pencil size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-blue-400 pointer-events-none" />
                        <input
                          value={item.editName ?? item.name}
                          onChange={(e) => {
                            const updated = [...items];
                            updated[i] = { ...updated[i], editName: e.target.value };
                            onItemsChange(updated);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && item.photoId) {
                              onRename(item.photoId, item.editName ?? item.name);
                              const updated = [...items];
                              updated[i] = { ...updated[i], name: item.editName ?? item.name };
                              onItemsChange(updated);
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          className="w-full text-xs font-semibold text-slate-700 bg-blue-50/60 border border-blue-200 rounded-lg pl-7 pr-2.5 py-1.5 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                          placeholder="Rename file..."
                        />
                      </div>
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        onClick={() => {
                          if (!item.photoId) return;
                          onRename(item.photoId, item.editName ?? item.name);
                          const updated = [...items];
                          updated[i] = { ...updated[i], name: item.editName ?? item.name };
                          onItemsChange(updated);
                        }}
                        className="w-8 h-8 flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-lg flex-shrink-0 shadow-sm shadow-blue-200 transition-colors"
                      >
                        <Check size={13} />
                      </motion.button>
                    </div>
                  </div>
                </div>
              ))}

              {/* 에러 항목 */}
              {items.filter(b => b.status === "error").map((item, i) => (
                <div key={`err-${i}`} className="flex items-center gap-3 bg-red-50 rounded-xl px-4 py-3 border border-red-100">
                  <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-red-700 truncate">{item.name}</p>
                    <p className="text-xs text-red-400">Failed to process</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
}
