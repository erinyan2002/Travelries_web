"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Upload, MapPin, Users, CalendarDays, Clock, FileImage, Ruler,
  CheckCircle2, Loader2, AlertTriangle, Navigation, X, Check, Pencil,
  ChevronLeft, ChevronRight, EyeOff, Save, Search, LocateFixed,
} from "lucide-react";
import { cropFaceThumbnails, forwardGeocode, reverseGeocode } from "@/lib/uploadHelpers";
import type { Person } from "@/lib/peopleApi";

type Box = { x: number; y: number; width: number; height: number };

export type BatchFile = {
  name: string;
  // pending → processing (analyzing) → ready (waiting for review) → saving → done
  status: "pending" | "processing" | "ready" | "saving" | "done" | "error";
  info: string;
  file?: File;
  previewUrl?: string;
  fileSize?: string;
  location?: string;
  captureDate?: string;
  captureTime?: string;
  captureTimestamp?: string;
  lat?: number;
  lng?: number;
  /** gps = from the photo; estimated = from the photo taken closest in time; manual = set in review. */
  locationSource?: "gps" | "estimated" | "manual";
  locationNote?: string;
  boxes: Box[];
  descriptors: number[][];
  confidences: number[];
  /** Face indices to save (all of them by default). Unpicked faces aren't saved at all. */
  selectedFaces: number[];
  /** Face index → existing people.id, the same "Who?" tag as the single-photo picker. */
  personIds: Record<number, string>;
  /** Left out of "Save all". */
  skip?: boolean;
  editName?: string;
  photoId?: string;
};

export type BatchPhase = "analyzing" | "review" | "saving" | "done";

// Home page multi-file upload. Photos are analyzed first and NOT saved until the
// user presses Save: tapping a photo opens its full analysis (face boxes, which
// faces to keep and who they are, date and place) so a group photo's faces can be
// picked and tagged per photo, the same as a single upload.
export default function BatchUploadPanel({ items, phase, people, onItemsChange, onSave, onClose }: {
  items: BatchFile[];
  phase: BatchPhase;
  people: Person[];
  onItemsChange: (items: BatchFile[]) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const total     = items.length;
  const analyzed  = items.filter((b) => b.status !== "pending" && b.status !== "processing").length;
  const reviewable = items.filter((b) => b.status === "ready" || b.status === "done");
  const toSave    = items.filter((b) => b.status === "ready" && !b.skip).length;
  const saved     = items.filter((b) => b.status === "done").length;
  const failed    = items.filter((b) => b.status === "error").length;
  const savedDone = items.filter((b) => b.status === "done" || b.status === "error" || b.skip).length;
  const progress  = phase === "analyzing" ? analyzed / (total || 1)
                  : phase === "saving"    ? savedDone / (total || 1) : 1;

  function update(i: number, patch: Partial<BatchFile>) {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onItemsChange(next);
  }

  return (
    <section className="tv-card overflow-hidden mb-6">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-200">
            <Upload size={16} className="text-white" />
          </div>
          <div>
            <h2 className="font-bold text-slate-800">Batch Upload</h2>
            <p className="text-xs text-slate-400">
              {phase === "analyzing" && `Analyzing ${analyzed} / ${total}`}
              {phase === "review"    && `${reviewable.length} photo${reviewable.length !== 1 ? "s" : ""} analyzed · not saved yet`}
              {phase === "saving"    && "Saving..."}
              {phase === "done"      && `${saved} saved`}
            </p>
          </div>
        </div>
        {(phase === "review" || phase === "done") && (
          <button onClick={onClose}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors">
            <X size={14} /> {phase === "review" ? "Cancel" : "Close"}
          </button>
        )}
      </div>

      {(phase === "analyzing" || phase === "saving") && (
        <div className="px-6 pt-4 pb-2">
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="text-xs text-slate-400 mt-1.5">{Math.round(progress * 100)}% complete</p>
        </div>
      )}

      {phase === "analyzing" && (
        <div className="px-6 pb-4 space-y-2 max-h-60 overflow-y-auto">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
              {item.status === "pending"    && <div className="w-5 h-5 rounded-full border-2 border-slate-300 flex-shrink-0" />}
              {item.status === "processing" && <Loader2 size={18} className="text-blue-500 animate-spin flex-shrink-0" />}
              {item.status === "ready"      && <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />}
              {item.status === "error"      && <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{item.name}</p>
                <p className={`text-xs mt-0.5 ${item.status === "error" ? "text-red-400" : "text-slate-400"}`}>
                  {item.info || (item.status === "pending" ? "Waiting..." : "Analyzing...")}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {phase !== "analyzing" && (
        <div className="px-6 py-4">
          {phase === "review" && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 flex items-center gap-3 mb-4">
              <Users size={18} className="text-sky-500 flex-shrink-0" />
              <p className="text-sm font-semibold text-sky-800">
                Tap a photo to see its analysis, pick which faces to keep and who they are. Nothing is saved until you press Save.
              </p>
            </div>
          )}
          {phase === "done" && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3 mb-4">
              <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />
              <p className="text-sm font-bold text-emerald-700">
                {saved} photo{saved !== 1 ? "s" : ""} saved!
                {failed > 0 && <span className="font-semibold text-red-500"> · {failed} failed</span>}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {items.map((item, i) => {
              const faces = item.boxes.length;
              const picked = item.selectedFaces.length;
              const tappable = phase === "review" && item.status === "ready";
              return (
                <button key={i} type="button" disabled={!tappable} onClick={() => setOpenIndex(i)}
                  className={`text-left rounded-2xl overflow-hidden border bg-white shadow-sm transition-all ${
                    tappable ? "hover:shadow-md hover:border-sky-300 cursor-pointer" : "cursor-default"} ${
                    item.skip ? "opacity-45 border-slate-200" : item.status === "error" ? "border-red-200" : "border-slate-100"}`}>
                  <div className="relative aspect-[4/5] bg-slate-100">
                    {item.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.previewUrl} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><AlertTriangle size={22} className="text-red-300" /></div>
                    )}
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/90 shadow-sm text-slate-600">
                      {faces > 0 ? <><Users size={9} className="text-blue-600" /> {picked === faces ? faces : `${picked}/${faces}`}</> : <><FileImage size={9} /> Scene</>}
                    </span>
                    {item.status === "saving" && (
                      <span className="absolute inset-0 bg-white/50 flex items-center justify-center"><Loader2 size={22} className="text-blue-500 animate-spin" /></span>
                    )}
                    {item.status === "done" && (
                      <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow"><Check size={13} strokeWidth={3} /></span>
                    )}
                    {item.skip && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[11px] font-bold text-white bg-slate-700/80 px-2 py-0.5 rounded-full">Won&apos;t be saved</span>
                      </span>
                    )}
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-xs font-bold text-slate-800 truncate">{item.editName ?? item.name}</p>
                    <p className={`text-[10px] truncate mt-0.5 ${item.status === "error" ? "text-red-400" : "text-slate-400"}`}>
                      {item.status === "error" ? item.info || "Failed"
                        : item.lat === undefined ? <span className="text-orange-500 font-semibold">No location · tap to set</span>
                        : `${item.locationSource === "estimated" ? "≈ " : ""}${item.location?.split(",")[0] ?? ""}`}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {phase === "review" && (
            <button onClick={onSave} disabled={toSave === 0}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-sky-400 to-blue-500 hover:from-sky-500 hover:to-blue-600 shadow-lg shadow-sky-200 transition-all disabled:opacity-40 disabled:shadow-none">
              <Save size={16} /> Save {toSave} photo{toSave !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}

      {openIndex !== null && items[openIndex] && (
        <ReviewModal
          key={openIndex} // fresh face thumbnails per photo
          item={items[openIndex]}
          people={people}
          otherPlaces={items.filter((it, j) => j !== openIndex && it.status === "ready" && it.lat !== undefined && it.location)
            .filter((it, j, arr) => arr.findIndex((o) => o.location === it.location) === j)
            .slice(0, 3)
            .map((it) => ({ lat: it.lat!, lng: it.lng!, location: it.location! }))}
          toSave={toSave}
          onSaveAll={() => { setOpenIndex(null); onSave(); }}
          onChange={(patch) => update(openIndex, patch)}
          onClose={() => setOpenIndex(null)}
          position={items.filter((it) => it.status === "ready").indexOf(items[openIndex]) + 1}
          count={items.filter((it) => it.status === "ready").length}
          onStep={(dir) => {
            const order = items.map((it, i) => (it.status === "ready" ? i : -1)).filter((i) => i >= 0);
            const at = order.indexOf(openIndex);
            const next = order[at + dir];
            if (next !== undefined) setOpenIndex(next);
          }}
        />
      )}
    </section>
  );
}

function ReviewModal({ item, people, otherPlaces, toSave, onSaveAll, onChange, onClose, onStep, position, count }: {
  item: BatchFile;
  people: Person[];
  otherPlaces: { lat: number; lng: number; location: string }[];
  toSave: number;
  onSaveAll: () => void;
  onChange: (patch: Partial<BatchFile>) => void;
  onClose: () => void;
  onStep: (dir: 1 | -1) => void;
  position: number;
  count: number;
}) {
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeStatus, setPlaceStatus] = useState<"idle" | "searching" | "error">("idle");

  function setPlace(lat: number, lng: number, location: string) {
    onChange({ lat, lng, location, locationSource: "manual", locationNote: undefined });
    setPlaceStatus("idle");
  }
  async function searchPlace() {
    if (!placeQuery.trim()) return;
    setPlaceStatus("searching");
    const r = await forwardGeocode(placeQuery.trim());
    if (r) setPlace(r.lat, r.lng, r.name); else setPlaceStatus("error");
  }
  function useCurrentLocation() {
    if (!navigator.geolocation) { setPlaceStatus("error"); return; }
    setPlaceStatus("searching");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const name = await reverseGeocode(coords.latitude, coords.longitude);
        setPlace(coords.latitude, coords.longitude, name || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
      },
      () => setPlaceStatus("error"),
    );
  }
  const file = item.file;
  const boxes = item.boxes;

  useEffect(() => {
    let alive = true;
    if (file && boxes.length > 0) {
      cropFaceThumbnails(file, boxes).then((t) => { if (alive) setThumbs(t); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [file, boxes]);

  const selected = new Set(item.selectedFaces);
  function toggleFace(i: number) {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i); else next.add(i);
    onChange({ selectedFaces: [...next].sort((a, b) => a - b) });
  }
  function assign(i: number, personId: string) {
    const next = { ...item.personIds };
    if (personId) next[i] = personId; else delete next[i];
    onChange({ personIds: next });
  }

  const info: [string, string | undefined, React.ElementType][] = [
    ["Capture date", item.captureDate, CalendarDays],
    ["Capture time", item.captureTime, Clock],
    ["Location",     item.location,    MapPin],
    ["Coordinates",  item.lat !== undefined && item.lng !== undefined ? `${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}` : undefined, Navigation],
    ["File size",    item.fileSize,    Ruler],
  ];

  // Portaled to <body>: the panel is a tv-card, whose backdrop-filter makes it the
  // containing block for `fixed` children, so in place the modal was clipped to the card.
  return createPortal(
    <div className="fixed inset-0 tv-overlay z-[4000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="tv-modal max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
          <span className="text-sky-500 font-bold text-lg leading-none">✦</span>
          <h2 className="font-bold text-slate-800 flex-1">Analysis Result</h2>
          <span className="text-xs font-semibold text-slate-400">{position} / {count}</span>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div className="relative">
            <Pencil size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400 pointer-events-none" />
            <input value={item.editName ?? item.name} onChange={(e) => onChange({ editName: e.target.value })}
              placeholder="Photo name"
              className="w-full text-sm font-semibold text-slate-700 bg-blue-50/60 border border-blue-200 rounded-xl pl-8 pr-3 py-2 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100" />
          </div>

          {/* Capped at 45vh so the picker and details stay in view; the inner wrapper
              shrinks to the image so the % face boxes still line up. */}
          <div className="flex justify-center rounded-xl overflow-hidden border border-slate-100 bg-slate-50">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.previewUrl} alt={item.name} className="block max-w-full max-h-[45vh] w-auto h-auto" />
            {boxes.map((b, i) => (
              <div key={i} onClick={() => toggleFace(i)}
                className={`absolute rounded-sm border-2 cursor-pointer transition-colors ${
                  selected.has(i) ? "border-emerald-400 bg-emerald-400/10" : "border-slate-300/80 border-dashed"}`}
                style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%` }}>
                <span className={`absolute -top-2.5 -left-2.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                  selected.has(i) ? "bg-emerald-500" : "bg-slate-400"}`}>{i + 1}</span>
              </div>
            ))}
          </div>
          </div>

          <div className={`flex items-center justify-between rounded-xl px-4 py-3 ${
            boxes.length > 0 ? "bg-gradient-to-r from-sky-400 to-blue-500" : "bg-gradient-to-r from-slate-400 to-slate-500"}`}>
            <div>
              <p className="text-xs text-white/70">AI Classification</p>
              <p className="font-extrabold text-white">{boxes.length > 0 ? "Portrait" : "Scenery"}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-extrabold text-white">{boxes.length}</p>
              <p className="text-xs text-white/70">detected</p>
            </div>
          </div>

          {boxes.length > 0 && (
            <div className="rounded-xl border border-sky-100 bg-sky-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-700">
                Faces to save to People ({selected.size}/{boxes.length})
              </p>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {boxes.map((_, i) => {
                  const on = selected.has(i);
                  return (
                    <div key={i} className="flex flex-shrink-0 flex-col items-center gap-1">
                      <button type="button" onClick={() => toggleFace(i)} className="flex flex-col items-center gap-1">
                        <div className={`relative h-16 w-16 overflow-hidden rounded-full border-2 ${on ? "border-emerald-500 ring-2 ring-emerald-200" : "border-slate-200 opacity-60"}`}>
                          {thumbs[i]
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={thumbs[i]} alt={`Person ${i + 1}`} className="h-full w-full object-cover" />
                            : <div className="h-full w-full animate-pulse bg-slate-200" />}
                          {on && (
                            <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/30">
                              <Check size={20} className="text-white drop-shadow" />
                            </div>
                          )}
                        </div>
                        <span className={`text-[11px] font-semibold ${on ? "text-emerald-600" : "text-slate-400"}`}>Person {i + 1}</span>
                      </button>
                      {on && people.length > 0 && (
                        <select value={item.personIds[i] ?? ""} onChange={(e) => assign(i, e.target.value)}
                          className="w-20 text-[10px] font-semibold text-slate-600 border border-slate-200 rounded-md px-0.5 py-0.5 outline-none bg-white">
                          <option value="">Who?</option>
                          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400">Tap a face (or its box) to keep or leave it out.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {info.map(([label, value, Icon]) => (
              <div key={label} className={`flex items-start gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 ${label === "Location" ? "col-span-2" : ""}`}>
                <Icon size={13} className="text-sky-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-400">{label}</p>
                  <p className="text-xs font-semibold text-slate-700 break-words">{value || "Not available"}</p>
                </div>
              </div>
            ))}
          </div>
          {item.locationSource !== "gps" && (
            <div className={`rounded-xl border p-3 space-y-2 ${item.lat === undefined ? "bg-orange-50 border-orange-200" : "bg-sky-50 border-sky-100"}`}>
              <p className={`text-xs font-bold flex items-center gap-1.5 ${item.lat === undefined ? "text-orange-700" : "text-sky-700"}`}>
                <MapPin size={13} />
                {item.lat === undefined ? "No GPS data — set a place so it shows on the map"
                  : item.locationSource === "estimated" ? item.locationNote : "Place set by you"}
              </p>
              {otherPlaces.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {otherPlaces.map((p) => (
                    <button key={p.location} type="button" onClick={() => setPlace(p.lat, p.lng, p.location)}
                      className="text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 hover:border-sky-300 px-2 py-1 rounded-lg truncate max-w-full">
                      Same as: {p.location.split(",").slice(0, 2).join(",")}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-1.5">
                <input value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchPlace()}
                  placeholder="Search a place (e.g. Seongsu, Seoul)"
                  className="flex-1 min-w-0 text-xs border border-slate-200 rounded-lg px-2.5 py-2 outline-none bg-white focus:border-sky-400" />
                <button type="button" onClick={searchPlace} disabled={placeStatus === "searching"} title="Search"
                  className="px-2.5 rounded-lg bg-slate-800 text-white disabled:opacity-50">
                  {placeStatus === "searching" ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                </button>
                <button type="button" onClick={useCurrentLocation} disabled={placeStatus === "searching"} title="Use current location"
                  className="px-2.5 rounded-lg bg-sky-500 text-white disabled:opacity-50">
                  <LocateFixed size={14} />
                </button>
              </div>
              {placeStatus === "error" && <p className="text-[11px] text-red-500">Couldn&apos;t find that place. Try another search.</p>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-100">
          <button onClick={() => onStep(-1)} disabled={position <= 1}
            className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"><ChevronLeft size={16} /></button>
          <button onClick={() => onChange({ skip: !item.skip })}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
              item.skip ? "bg-slate-700 text-white border-slate-700" : "text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
            <EyeOff size={13} /> {item.skip ? "Skipped" : "Don't save"}
          </button>
          <span className="flex-1" />
          {/* Next until the last photo, then Save — "Done" used to only close, which read as saved. */}
          {position < count ? (
            <button onClick={() => onStep(1)}
              className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-sky-500 to-blue-600">
              Next <ChevronRight size={15} />
            </button>
          ) : (
            <button onClick={onSaveAll} disabled={toSave === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-sky-500 to-blue-600 disabled:opacity-40">
              <Save size={15} /> Save {toSave} photo{toSave !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
