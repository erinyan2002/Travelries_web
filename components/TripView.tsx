"use client";

// The trip page body (app/albums/trip/[id]/page.tsx loads the data): a Travel
// Memory overview plus Map, Photos, People and Diary tabs for one detected trip.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, CalendarDays, Camera, MapPin, Users, Route, Sparkles, Share2, Link2, Loader2, X,
  LayoutDashboard, Map as MapIcon, Images, ScanFace, BookOpen, Trophy, Check,
} from "lucide-react";
import FaceChip from "@/components/FaceChip";
import ShareCardModal from "@/components/ShareCardModal";
import { Person } from "@/lib/peopleApi";
import { buildPersonGroups, MATCH_THRESHOLD, PersonCluster } from "@/lib/faceClustering";
import { getPhotoDate, Trip } from "@/lib/trips";
import { summarizeTrip, sortChronologically, formatTripDates, formatDistance, placeLabel } from "@/lib/tripMemory";
import { drawTripMemoryCard } from "@/lib/tripCard";
import { shareTrip } from "@/lib/tripShareUtils";
import { DiaryLang, DIARY_LANGS, loadDiaryLang, storeDiaryLang, requestDiary, diaryCacheKey, photoSetKey } from "@/lib/diary";
import { fetchTripDiary } from "@/lib/photosApi";
import { burstConfetti } from "@/lib/confetti";
import { FacePhoto, MapPhoto } from "@/lib/types";

const TripRouteMap = dynamic(() => import("@/components/TripRouteMap"), {
  ssr: false,
  loading: () => <div className="w-full h-64 rounded-2xl bg-slate-100 animate-pulse" />,
});

type Tab = "overview" | "map" | "photos" | "people" | "diary";
const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "map",      label: "Map",      icon: MapIcon },
  { key: "photos",   label: "Photos",   icon: Images },
  { key: "people",   label: "People",   icon: ScanFace },
  { key: "diary",    label: "Diary",    icon: BookOpen },
];

const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

type TripPerson = { cluster: PersonCluster; faces: PersonCluster["faces"] };

export default function TripView({ trip, facePhotos, people, uid }: {
  trip: Trip; facePhotos: FacePhoto[]; people: Person[]; uid: string | null;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [viewing, setViewing] = useState<MapPhoto | null>(null);
  const [showCard, setShowCard] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [lang, setLang] = useState<DiaryLang>(loadDiaryLang);
  const [diary, setDiary] = useState<string | null>(null);
  const [diaryCached, setDiaryCached] = useState(false);
  const [diaryLoading, setDiaryLoading] = useState(false);
  const [diaryError, setDiaryError] = useState<string | null>(null);

  // Show an already-written story without calling the AI.
  useEffect(() => {
    if (!uid) return;
    fetchTripDiary(uid, diaryCacheKey(photoSetKey(trip.photos), loadDiaryLang())).then((cached) => {
      if (cached) { setDiary(cached); setDiaryCached(true); }
    }).catch(() => {});
  }, [uid, trip]);

  const memory = useMemo(() => summarizeTrip(trip), [trip]);
  const ordered = useMemo(() => sortChronologically(trip.photos), [trip]);

  // People in this trip = person groups (same clustering as the People page)
  // with at least one face in one of the trip's photos.
  const tripPeople = useMemo<TripPerson[]>(() => {
    const ids = new Set(trip.photos.map((p) => p.id));
    return buildPersonGroups(facePhotos, people, MATCH_THRESHOLD)
      .map((cluster) => ({ cluster, faces: cluster.faces.filter((f) => ids.has(f.photo.id)) }))
      .filter((p) => p.faces.length > 0)
      .sort((a, b) => b.faces.length - a.faces.length);
  }, [trip, facePhotos, people]);

  const cover = useMemo(() => ordered.find((p) => (p.faceCount ?? 0) === 0) ?? ordered[0], [ordered]);

  async function writeStory(force = false, useLang: DiaryLang = lang) {
    setTab("diary");
    setDiaryLoading(true);
    setDiaryError(null);
    try {
      const r = await requestDiary(uid, trip.photos, useLang, force);
      setDiary(r.text);
      setDiaryCached(r.cached);
      if (!r.cached) burstConfetti({ y: 0.35 });
    } catch (err) {
      setDiary(null);
      setDiaryError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiaryLoading(false);
    }
  }

  async function changeLang(next: DiaryLang) {
    setLang(next);
    storeDiaryLang(next);
    setDiary(null);
    setDiaryError(null);
    const cached = uid ? await fetchTripDiary(uid, diaryCacheKey(photoSetKey(trip.photos), next)) : null;
    setDiary(cached);
    setDiaryCached(!!cached);
  }

  async function handleShareLink() {
    setSharing(true);
    try {
      setShareUrl(await shareTrip(trip, diary));
    } catch (err) {
      alert(`Failed to create trip link:\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSharing(false);
    }
  }

  const stats = [
    { icon: CalendarDays, value: String(memory.dayCount), label: memory.dayCount === 1 ? "Day" : "Days", tint: "from-sky-400 to-blue-500" },
    { icon: Camera, value: String(memory.photoCount), label: "Photos", tint: "from-cyan-400 to-sky-500" },
    { icon: MapPin, value: String(memory.places.length), label: memory.places.length === 1 ? "Place" : "Places", tint: "from-teal-400 to-cyan-500" },
    { icon: Users, value: String(tripPeople.length), label: tripPeople.length === 1 ? "Person" : "People", tint: "from-amber-400 to-orange-500" },
    { icon: Route, value: formatDistance(memory.distanceKm), label: "Traveled", tint: "from-rose-400 to-pink-500" },
  ];

  return (
    <>
      <div>
        {/* ── Hero: cover photo with the trip's title ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="relative h-60 sm:h-72 rounded-3xl overflow-hidden shadow-[0_18px_40px_-18px_rgba(3,105,161,0.55)] mb-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/85 via-slate-900/25 to-transparent" />
          <Link href="/albums?view=trips"
            className="absolute top-3 left-3 flex items-center gap-1 bg-white/85 backdrop-blur-sm text-slate-700 text-xs font-bold pl-2 pr-3 py-1.5 rounded-full shadow-sm hover:bg-white transition-colors">
            <ArrowLeft size={14} /> Trips
          </Link>
          <div className="absolute inset-x-0 bottom-0 p-5">
            <p className="text-[11px] font-black tracking-[0.2em] text-sky-200">TRAVEL MEMORY</p>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight mt-0.5">{memory.title}</h1>
            <p className="text-sm font-semibold text-white/80 mt-1 flex items-center gap-1.5">
              <CalendarDays size={14} /> {formatTripDates(memory.start, memory.end)}
            </p>
            <p className="text-sm font-bold text-white mt-2">
              {memory.photoCount} Photos · {memory.places.length} Places · {tripPeople.length} {tripPeople.length === 1 ? "Person" : "People"}
            </p>
          </div>
        </motion.div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 p-1 mb-5 bg-white/80 backdrop-blur-sm rounded-2xl border border-white shadow-sm overflow-x-auto no-scrollbar">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button key={key} type="button" onClick={() => setTab(key)}
                className={`relative flex-1 min-w-[64px] flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 py-2 rounded-xl text-[11px] sm:text-[13px] font-bold transition-colors ${
                  active ? "text-white" : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"}`}>
                {active && (
                  <motion.span layoutId="trip-tab" transition={{ type: "spring", stiffness: 500, damping: 38 }}
                    className="absolute inset-0 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 shadow-md shadow-blue-300/50" />
                )}
                <Icon size={16} strokeWidth={2.2} className="relative" />
                <span className="relative">{label}</span>
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={tab}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}>

            {/* ── Overview: the Travel Memory ── */}
            {tab === "overview" && (
              <div className="space-y-4">
                <div className="grid grid-cols-5 gap-1.5 sm:gap-2.5">
                  {stats.map(({ icon: Icon, value, label, tint }) => (
                    <div key={label} className="tv-card px-1 py-2.5 sm:p-3 flex flex-col items-center text-center">
                      <span className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-br ${tint} flex items-center justify-center shadow-sm mb-1.5`}>
                        <Icon size={14} className="text-white" />
                      </span>
                      <p className="text-[15px] sm:text-lg font-extrabold text-slate-800 leading-tight whitespace-nowrap">{value}</p>
                      <p className="text-[11px] font-semibold text-slate-400">{label}</p>
                    </div>
                  ))}
                </div>

                {(memory.mostVisited || tripPeople.length > 0) && (
                  <div className="grid sm:grid-cols-2 gap-3">
                    {memory.mostVisited && (
                      <div className="tv-card p-4 flex items-center gap-3">
                        <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center shadow-md shadow-orange-200 flex-shrink-0">
                          <Trophy size={20} className="text-white" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Most visited place</p>
                          <p className="font-extrabold text-slate-800 truncate">{memory.mostVisited.place}</p>
                          <p className="text-xs text-slate-400">{memory.mostVisited.photos} photos here</p>
                        </div>
                      </div>
                    )}
                    {tripPeople.length > 0 && (
                      <button type="button" onClick={() => setTab("people")} className="tv-card tv-card-hover p-4 text-left">
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">People you traveled with</p>
                        <div className="flex -space-x-2">
                          {tripPeople.slice(0, 6).map(({ cluster, faces }) => {
                            const f = faces[0];
                            const box = f.photo.boxes?.[f.boxIndex];
                            return box ? (
                              <FaceChip key={cluster.id} imageUrl={f.photo.imageUrl} box={box} size={40} ringClass="ring-white" />
                            ) : null;
                          })}
                          {tripPeople.length > 6 && (
                            <span className="w-10 h-10 rounded-full bg-slate-100 ring-2 ring-offset-2 ring-white flex items-center justify-center text-xs font-bold text-slate-500">
                              +{tripPeople.length - 6}
                            </span>
                          )}
                        </div>
                      </button>
                    )}
                  </div>
                )}

                {/* Day-by-day journey */}
                <div className="tv-card p-4 sm:p-5">
                  <p className="tv-section-title mb-4 flex items-center gap-2"><Route size={16} className="text-blue-500" /> Your Journey</p>
                  <div className="relative">
                    <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gradient-to-b from-sky-300 via-cyan-200 to-transparent" />
                    <div className="space-y-5">
                      {memory.days.map((d) => (
                        <div key={d.day} className="relative pl-10">
                          <span className="absolute left-0 top-0 w-[31px] h-[31px] rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-white text-[11px] font-black flex items-center justify-center ring-4 ring-white shadow">
                            {d.day}
                          </span>
                          <p className="text-sm font-extrabold text-slate-800 leading-[31px]">
                            Day {d.day} <span className="font-semibold text-slate-400">· {dayLabel(d.date)}</span>
                          </p>
                          {d.stops.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 mt-1.5">
                              {d.stops.map((s, i) => {
                                const photo = d.photos.find((p) => p.id === s.photoIds[0]);
                                return (
                                  <span key={`${s.place}-${i}`} className="flex items-center gap-1.5">
                                    {i > 0 && <span className="text-sky-400 font-bold">→</span>}
                                    <button type="button" onClick={() => photo && setViewing(photo)}
                                      className="flex items-center gap-1.5 bg-sky-50 hover:bg-sky-100 border border-sky-100 rounded-full pl-1 pr-2.5 py-1 transition-colors">
                                      {photo && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={photo.imageUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                                      )}
                                      <span className="text-xs font-bold text-slate-700">{s.place}</span>
                                      <span className="text-[10px] font-semibold text-slate-400">{time(s.time)}</span>
                                    </button>
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-400 mt-1">{d.photos.length} photos (no location)</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-4">
                    Tip: open a photo in Albums and tap <strong>Identify Landmark</strong> to show landmark names here.
                  </p>
                </div>

                {/* Actions */}
                <div className="tv-card p-4 sm:p-5 text-center bg-gradient-to-br from-sky-50/90 via-white/90 to-cyan-50/90">
                  <p className="font-extrabold text-slate-800">Turn this trip into a story</p>
                  <p className="text-xs text-slate-500 mt-0.5 mb-3">AI reads your photos and writes a travel diary.</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button onClick={() => writeStory(false)} className="tv-btn-primary text-sm px-4 py-2.5">
                      <Sparkles size={15} /> Generate My Travel Story
                    </button>
                    <button onClick={() => setShowCard(true)} className="tv-btn-soft text-sm px-4 py-2.5">
                      <Share2 size={15} /> Memory card
                    </button>
                    <button onClick={handleShareLink} disabled={sharing} className="tv-btn-soft text-sm px-4 py-2.5">
                      {sharing ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} Share link
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Map ── */}
            {tab === "map" && (
              memory.route.length > 0 ? (
                <div className="space-y-3">
                  <div className="tv-card p-2"><TripRouteMap points={memory.route} /></div>
                  <div className="tv-card p-4">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Route · {formatDistance(memory.distanceKm)}</p>
                    <p className="text-sm font-semibold text-slate-700 leading-relaxed">{memory.journey.join("  →  ") || "—"}</p>
                  </div>
                </div>
              ) : (
                <div className="tv-card p-10 text-center text-sm text-slate-400">None of these photos have GPS data, so there&apos;s no route to show.</div>
              )
            )}

            {/* ── Photos by day ── */}
            {tab === "photos" && (
              <div className="space-y-5">
                {memory.days.map((d) => (
                  <div key={d.day}>
                    <p className="text-sm font-extrabold text-slate-800 mb-2">
                      Day {d.day} <span className="font-semibold text-slate-400">· {dayLabel(d.date)} · {d.photos.length}</span>
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {d.photos.map((p) => (
                        <button key={p.id} onClick={() => setViewing(p)} className="group relative aspect-square rounded-xl overflow-hidden bg-slate-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.imageUrl} alt={p.fileName} loading="lazy"
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                          <span className="absolute bottom-1 left-1 text-[10px] font-bold text-white bg-black/40 rounded-full px-1.5 py-0.5">
                            {time(getPhotoDate(p))}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── People ── */}
            {tab === "people" && (
              tripPeople.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {tripPeople.map(({ cluster, faces }) => {
                    const f = faces[0];
                    const box = f.photo.boxes?.[f.boxIndex];
                    const ids = [...new Set(faces.map((x) => x.photo.id))];
                    return (
                      <Link key={cluster.id}
                        href={`/albums?photoIds=${ids.join(",")}&personLabel=${encodeURIComponent(cluster.label)}`}
                        className="tv-card tv-card-hover p-3 flex flex-col items-center text-center">
                        {box && <FaceChip imageUrl={f.photo.imageUrl} box={box} size={60} ringClass="ring-sky-300" />}
                        <p className="text-sm font-extrabold text-slate-800 mt-2 truncate max-w-full">{cluster.label}</p>
                        <p className="text-[11px] text-slate-400">{ids.length} photo{ids.length === 1 ? "" : "s"}</p>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="tv-card p-10 text-center text-sm text-slate-400">No faces were saved from this trip&apos;s photos.</div>
              )
            )}

            {/* ── Diary ── */}
            {tab === "diary" && (
              <div className="tv-card p-5">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <p className="font-extrabold text-slate-800 flex items-center gap-2"><Sparkles size={16} className="text-blue-500" /> Travel Story</p>
                  <div className="inline-flex p-1 rounded-xl bg-slate-100">
                    {DIARY_LANGS.map(({ value, label }) => (
                      <button key={value} onClick={() => value !== lang && changeLang(value)} disabled={diaryLoading}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                          value === lang ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {diaryLoading ? (
                  <div className="flex items-center gap-2 text-slate-400 text-sm py-10 justify-center">
                    <Loader2 size={16} className="animate-spin" /> {lang === "ko" ? "여행기를 쓰는 중..." : "Writing your travel story..."}
                  </div>
                ) : diary ? (
                  <>
                    <p className="text-[15px] text-slate-700 leading-relaxed whitespace-pre-wrap">{diary}</p>
                    <div className="flex items-center justify-between mt-4">
                      <p className="text-[11px] text-slate-400">{diaryCached ? (lang === "ko" ? "저장된 여행기" : "Saved story") : ""}</p>
                      <button onClick={() => writeStory(true)} className="flex items-center gap-1.5 text-xs font-bold text-blue-500 hover:text-blue-700">
                        <Sparkles size={12} /> {lang === "ko" ? "다시 쓰기" : "Re-generate"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-6">
                    {diaryError && <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 mb-4 text-left">{diaryError}</p>}
                    <p className="text-sm text-slate-500 mb-3">
                      {lang === "ko" ? `${memory.photoCount}장의 사진으로 여행기를 써 드려요.` : `AI will write a story from all ${memory.photoCount} photos.`}
                    </p>
                    <button onClick={() => writeStory(false)} className="tv-btn-primary text-sm px-4 py-2.5">
                      <Sparkles size={15} /> Generate My Travel Story
                    </button>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Photo viewer */}
      <AnimatePresence>
        {viewing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[3000] tv-overlay flex items-center justify-center p-4" onClick={() => setViewing(null)}>
            <div className="tv-modal overflow-hidden max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={viewing.imageUrl} alt={viewing.fileName} className="w-full max-h-[65dvh] object-contain bg-slate-900" />
              <div className="p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-slate-800 truncate">{placeLabel(viewing) ?? viewing.fileName}</p>
                  <p className="text-xs text-slate-400">{dayLabel(getPhotoDate(viewing))} · {time(getPhotoDate(viewing))}</p>
                </div>
                <button onClick={() => setViewing(null)} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share link result */}
      {shareUrl && (
        <div className="fixed inset-0 z-[3000] tv-overlay flex items-center justify-center p-4" onClick={() => setShareUrl(null)}>
          <div className="tv-modal p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <p className="font-extrabold text-slate-800 mb-1">Trip link ready</p>
            <p className="text-xs text-slate-400 mb-3">Anyone with the link can view this trip — no login needed.</p>
            <div className="flex gap-2">
              <input readOnly value={shareUrl} className="flex-1 min-w-0 text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-600" />
              <button onClick={async () => {
                try {
                  if (navigator.share) await navigator.share({ title: memory.title, url: shareUrl });
                  else { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }
                } catch { /* share sheet dismissed */ }
              }} className="tv-btn-primary text-xs px-3 py-2">
                {copied ? <><Check size={13} /> Copied</> : <><Share2 size={13} /> Share</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCard && (
        <ShareCardModal
          title="Travel Memory card"
          fileName={`${memory.title.replace(/\s+/g, "-").toLowerCase()}-memory.png`}
          onClose={() => setShowCard(false)}
          draw={(ctx, w, h) => drawTripMemoryCard(ctx, w, h, memory, [cover, ...ordered.filter((p) => p.id !== cover.id)], tripPeople.length)}
        />
      )}
    </>
  );
}
