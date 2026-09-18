"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import BottomNav from "@/components/BottomNav";
import PageHero from "@/components/PageHero";
import AnimatedNumber from "@/components/AnimatedNumber";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { supabase } from "@/lib/supabase";
import { MapPhoto, FacePhoto } from "@/lib/types";
import { fetchAllPhotos } from "@/lib/photosApi";
import { getSavedIds } from "@/lib/savedUtils";
import {
  BarChart2, Camera, Users, MapPin, Star,
  TrendingUp, Image as ImageIcon, CalendarDays, Clock, LayoutTemplate,
} from "lucide-react";
import ShareCardModal from "@/components/ShareCardModal";
import { loadImage, drawPolaroid, fillTextTracked, drawRouteDivider } from "@/lib/canvasCard";

// Scattered polaroid layout for the collage, back-to-front draw order (last
// entry ends up on top, centered and largest) — offsets are relative to the
// collage's own center point. When fewer than 5 photos are available, the
// slice kept is the tail of this array so the centered "hero" photo is
// always present and only the smaller background photos are dropped.
const COLLAGE_LAYOUT = [
  { dx: -260, dy: -55, size: 250, rot: -12 },
  { dx: 255, dy: -30, size: 240, rot: 10 },
  { dx: -195, dy: 100, size: 260, rot: 8 },
  { dx: 205, dy: 120, size: 250, rot: -9 },
  { dx: 5, dy: 10, size: 320, rot: -3 },
];

// Draws the 1080x1920 "Year in Review" share card: a scattered polaroid
// collage of recent photos, a headline number (total photos), and a short
// stat panel — Spotify-Wrapped-style summary of the year's travel activity.
// Dashed dividers echo the app's own map route line; the hero number gets a
// blue-to-violet gradient to match.
async function drawYearReviewCard(ctx: CanvasRenderingContext2D, w: number, h: number, stats: Stats, year: number) {
  const margin = 90;
  const dividerColor = "rgba(255,255,255,0.18)";

  ctx.fillStyle = "#0B1220";
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = "center";

  ctx.fillStyle = "#93C5FD";
  ctx.font = "700 28px system-ui, -apple-system, sans-serif";
  fillTextTracked(ctx, "✈ TRAVELRIES", w / 2, 100, 6);

  ctx.fillStyle = "#ffffff";
  ctx.font = "800 84px system-ui, -apple-system, sans-serif";
  ctx.fillText(String(year), w / 2, 195);
  ctx.font = "700 34px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText("Year in Review", w / 2, 242);

  drawRouteDivider(ctx, 290, w, margin, dividerColor);

  // Photo collage — up to 5 of the most recent photos, scattered as polaroids.
  const collagePhotos = stats.recentPhotos.slice(0, 5);
  const loadedPhotos = await Promise.all(
    collagePhotos.map((p) => (p.imageUrl ? loadImage(p.imageUrl).catch(() => null) : Promise.resolve(null)))
  );
  const layout = COLLAGE_LAYOUT.slice(COLLAGE_LAYOUT.length - loadedPhotos.length);
  const collageCenterX = w / 2;
  const collageCenterY = 580;
  loadedPhotos.forEach((img, i) => {
    const spot = layout[i];
    drawPolaroid(ctx, img, collageCenterX + spot.dx, collageCenterY + spot.dy, spot.size, spot.rot);
  });

  drawRouteDivider(ctx, 900, w, margin, dividerColor);

  const countText = String(stats.totalPhotos);
  const bigFontSize = countText.length <= 2 ? 190 : countText.length === 3 ? 160 : countText.length === 4 ? 130 : 100;
  const heroGradient = ctx.createLinearGradient(w / 2 - 320, 0, w / 2 + 320, 0);
  heroGradient.addColorStop(0, "#93C5FD");
  heroGradient.addColorStop(1, "#C4B5FD");
  ctx.fillStyle = heroGradient;
  ctx.font = `900 ${bigFontSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(countText, w / 2, 1060);
  ctx.font = "600 38px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText("photos captured", w / 2, 1120);

  drawRouteDivider(ctx, 1170, w, margin, dividerColor);

  const rows: { label: string; value: string }[] = [
    { label: "Places visited", value: String(stats.totalLocations) },
    { label: "Faces detected", value: String(stats.totalFacesDetected) },
    { label: "Top destination", value: stats.topLocations[0]?.name ?? "—" },
  ];
  const rowHeight = 130;
  const panelTop = 1200;
  const panelPadX = 40;
  const panelHeight = 48 + rows.length * rowHeight;

  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(margin, panelTop, w - margin * 2, panelHeight, 28);
  ctx.fill();
  ctx.stroke();

  rows.forEach((row, i) => {
    const rowTop = panelTop + 48 + i * rowHeight;
    const baseline = rowTop + 42;

    ctx.textAlign = "left";
    ctx.font = "600 34px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(row.label, margin + panelPadX, baseline);

    ctx.textAlign = "right";
    ctx.font = "800 42px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#ffffff";
    let value = row.value;
    while (ctx.measureText(value).width > 420 && value.length > 1) {
      value = value.slice(0, -2) + "…";
    }
    ctx.fillText(value, w - margin - panelPadX, baseline);

    if (i < rows.length - 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.beginPath();
      ctx.moveTo(margin + panelPadX, rowTop + rowHeight - 20);
      ctx.lineTo(w - margin - panelPadX, rowTop + rowHeight - 20);
      ctx.stroke();
    }
  });

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "700 34px system-ui, -apple-system, sans-serif";
  fillTextTracked(ctx, "✈ TRAVELRIES", w / 2, h - 110, 5);
}

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
  monthlyUploads: { label: string; count: number }[];
};

function StatCard({
  icon: Icon, label, value, gradient, glow, sub,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  gradient: string;
  glow: string;
  sub?: string;
}) {
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ y: -4, boxShadow: "0 16px 32px -8px rgba(0,0,0,0.12)" }}
      className="relative bg-white rounded-2xl border border-slate-200 shadow-sm p-5 overflow-hidden"
    >
      <div className={`absolute -top-6 -right-6 w-20 h-20 rounded-full blur-2xl opacity-30 ${glow}`} />
      <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-gradient-to-br ${gradient} shadow-md`}>
        <Icon size={20} className="text-white" />
      </div>
      <p className="relative text-2xl font-extrabold text-slate-900">
        <AnimatedNumber value={value} />
      </p>
      <p className="relative text-sm font-semibold text-slate-500 mt-0.5">{label}</p>
      {sub && <p className="relative text-xs text-slate-400 mt-1">{sub}</p>}
    </motion.div>
  );
}

function MonthlyBarChart({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="flex items-end gap-1 mt-3" style={{ height: "100px" }}>
      {data.map(({ label, count }, i) => {
        const h = count > 0 ? Math.max(Math.round((count / max) * 72), 6) : 2;
        return (
          <div key={label} className="flex-1 flex flex-col items-center justify-end gap-0.5 h-full min-w-0">
            <span className="text-[8px] text-slate-400 font-bold leading-none">{count > 0 ? count : ""}</span>
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: h }}
              transition={{ duration: 0.6, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ scaleY: count > 0 ? 1.08 : 1 }}
              style={{ transformOrigin: "bottom" }}
              className={`w-full rounded-t ${count > 0 ? "bg-gradient-to-t from-blue-500 to-indigo-400" : "bg-slate-100"}`}
            />
            <span className="text-[8px] text-slate-400 truncate w-full text-center leading-none mt-0.5">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function DonutChart({ portrait, scenery, total }: { portrait: number; scenery: number; total: number }) {
  if (total === 0) return <p className="text-slate-400 text-sm text-center py-8">No photos yet</p>;
  const r = 32;
  const circ = 2 * Math.PI * r;
  const arc = (portrait / total) * circ;
  return (
    <div className="flex items-center gap-5 mt-2">
      <div className="relative flex-shrink-0">
        <svg viewBox="0 0 80 80" width="80" height="80">
          <defs>
            <linearGradient id="donutGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
          <circle cx="40" cy="40" r={r} fill="none" stroke="#f1f5f9" strokeWidth="12" />
          {portrait > 0 && (
            <motion.circle
              cx="40" cy="40" r={r} fill="none" stroke="url(#donutGradient)" strokeWidth="12" strokeLinecap="round"
              initial={{ strokeDasharray: `0 ${circ}` }}
              animate={{ strokeDasharray: `${arc} ${circ - arc}` }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              style={{ transform: "rotate(-90deg)", transformOrigin: "40px 40px" }} />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-extrabold text-slate-800 leading-none">{total}</span>
          <span className="text-[9px] text-slate-400">total</span>
        </div>
      </div>
      <div className="space-y-3 flex-1">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500 flex-shrink-0" />
          <span className="text-sm text-slate-600 flex-1">With People</span>
          <span className="text-sm font-extrabold text-slate-900">{portrait}</span>
          <span className="text-xs text-slate-400 w-9 text-right">{Math.round(portrait/total*100)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-slate-200 flex-shrink-0" />
          <span className="text-sm text-slate-600 flex-1">Scenery</span>
          <span className="text-sm font-extrabold text-slate-900">{scenery}</span>
          <span className="text-xs text-slate-400 w-9 text-right">{Math.round(scenery/total*100)}%</span>
        </div>
      </div>
    </div>
  );
}


export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [showYearCard, setShowYearCard] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id ?? "guest";

      const { mapPhotos, facePhotos }: { mapPhotos: MapPhoto[]; facePhotos: FacePhoto[] } =
        uid === "guest" ? { mapPhotos: [], facePhotos: [] } : await fetchAllPhotos(uid);
      const savedIds = Array.from(await getSavedIds());

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

      // Monthly uploads — last 12 months
      const now = new Date();
      const monthlyData: { key: string; label: string; count: number }[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthlyData.push({
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
          label: d.toLocaleDateString("en-US", { month: "short" }),
          count: 0,
        });
      }
      mapPhotos.forEach((p) => {
        const raw = (p.captureDate && p.captureDate !== "Not available" && p.captureDate !== "날짜 없음")
          ? p.captureDate : p.uploadedAt;
        if (!raw) return;
        let d = new Date(raw);
        if (isNaN(d.getTime())) {
          const mx = raw.match(/(\d{4})[.\-\s]+(\d{1,2})[.\-\s]+(\d{1,2})/);
          if (mx) d = new Date(parseInt(mx[1]), parseInt(mx[2]) - 1, parseInt(mx[3]));
        }
        if (isNaN(d.getTime())) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const slot = monthlyData.find(s => s.key === key);
        if (slot) slot.count++;
      });
      const monthlyUploads = monthlyData.map(({ label, count }) => ({ label, count }));

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
        monthlyUploads,
      });
    }
    load();
  }, []);

  if (!stats) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-blue-50/40 px-6 py-8 pb-28 flex flex-col items-center justify-center gap-3">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 rounded-full border-[3px] border-blue-100 border-t-blue-600"
        />
        <p className="text-slate-400 text-sm">Loading your stats…</p>
        <BottomNav />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-blue-50/40 px-6 py-8 pb-28">
      <div className="max-w-5xl mx-auto">

        <PageHero
          icon={BarChart2}
          title="Statistics"
          subtitle="Summary of your photo activity"
          action={
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowYearCard(true)}
              className="flex items-center gap-1.5 bg-gradient-to-br from-sky-500 to-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-md shadow-blue-200"
            >
              <LayoutTemplate size={16} /> Year in Review
            </motion.button>
          }
        />

        {/* Stat cards */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6"
        >
          <StatCard icon={Camera} label="Photos"         value={stats.totalPhotos}     gradient="from-blue-500 to-blue-600"     glow="bg-blue-400"    sub="saved to map" />
          <StatCard icon={Users}  label="Face Photos"    value={stats.totalFacePhotos} gradient="from-violet-500 to-violet-600" glow="bg-violet-400"  sub={`${stats.totalFacesDetected} detected`} />
          <StatCard icon={MapPin} label="Places Visited" value={stats.totalLocations}  gradient="from-emerald-500 to-emerald-600" glow="bg-emerald-400" sub="unique locations" />
          <StatCard icon={Star}   label="Favorites"      value={stats.totalSaved}      gradient="from-amber-500 to-amber-600"   glow="bg-amber-400"   sub="saved photos" />
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

          {/* Photo type breakdown */}
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.4 }}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
                <TrendingUp size={15} className="text-indigo-500" />
              </div>
              <h2 className="font-bold text-slate-800">Photo Types</h2>
            </div>
            <DonutChart portrait={stats.portraitCount} scenery={stats.generalCount} total={stats.totalPhotos} />
            {stats.mostFacesPhoto && stats.totalPhotos > 0 && (
              <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-100 text-right">
                Max faces in one photo: <strong className="text-slate-600">{stats.mostFacesPhoto.faceCount}</strong>
              </p>
            )}
          </motion.section>

          {/* Top locations */}
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5"
          >
            <div className="flex items-center gap-2 mb-5">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
                <MapPin size={15} className="text-emerald-500" />
              </div>
              <h2 className="font-bold text-slate-800">Top 5 Locations</h2>
            </div>
            {stats.topLocations.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">No photos with location data</p>
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
                        <span className="text-xs text-slate-400 ml-2 flex-shrink-0">{loc.count}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.round((loc.count / stats.topLocations[0].count) * 100)}%` }}
                          transition={{ duration: 0.6, delay: 0.1 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                          className="h-full bg-gradient-to-r from-emerald-400 to-teal-400 rounded-full"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.section>
        </div>

        {/* Monthly uploads chart */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.4 }}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-5"
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
              <TrendingUp size={15} className="text-blue-500" />
            </div>
            <h2 className="font-bold text-slate-800">Monthly Uploads</h2>
            <span className="text-xs text-slate-400 ml-auto">Last 12 months</span>
          </div>
          <MonthlyBarChart data={stats.monthlyUploads} />
        </motion.section>

        {/* Recent uploads */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.4 }}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
        >
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 bg-slate-50">
            <Clock size={16} className="text-slate-400" />
            <h2 className="font-bold text-slate-800">Recent Uploads</h2>
            <span className="text-xs text-slate-400 bg-slate-200 px-2 py-0.5 rounded-full ml-auto">
              Last {stats.recentPhotos.length}
            </span>
          </div>
          {stats.recentPhotos.length === 0 ? (
            <div className="p-10 text-center">
              <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <ImageIcon size={24} className="text-slate-300" />
              </div>
              <p className="text-slate-400 text-sm">No photos yet</p>
            </div>
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.2 }}
              className="p-4 grid grid-cols-3 sm:grid-cols-6 gap-3"
            >
              {stats.recentPhotos.map((photo) => (
                <motion.div
                  key={photo.id}
                  variants={fadeUp}
                  whileHover={{ y: -3, scale: 1.03 }}
                  className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50 shadow-sm"
                >
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
                        <Users size={7} /> {photo.faceCount}
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </motion.section>

      </div>
      {showYearCard && (
        <ShareCardModal
          title="Year in Review"
          fileName="travelries-year-in-review.png"
          onClose={() => setShowYearCard(false)}
          draw={(ctx, w, h) => drawYearReviewCard(ctx, w, h, stats, new Date().getFullYear())}
        />
      )}
      <BottomNav />
    </main>
  );
}
