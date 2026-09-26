"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Camera, MapPin, Users, CalendarDays, ArrowRight, Plane, Images } from "lucide-react";
import AppLogo from "@/components/AppLogo";
import AnimatedNumber from "@/components/AnimatedNumber";
import { MapPhoto } from "@/lib/types";
import { Trip } from "@/lib/trips";
import { TripMemory, tripAnchorId, formatTripDates, placeLabel } from "@/lib/tripMemory";

// Home page pieces: a personal hero (greeting, stats, a polaroid stack of the
// latest photos), the latest-trip card shown while nothing is being uploaded,
// and a strip of recent photos.

const POLAROID_POSES = [
  { rotate: -9, x: -58, y: 10, z: 1 },
  { rotate: 7, x: 58, y: 6, z: 2 },
  { rotate: -2, x: 0, y: -6, z: 3 },
];

function greetingFor(hour: number) {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeHero({
  name, hour, stats, photos,
}: {
  name: string | null;
  /** null until mounted — the greeting depends on the viewer's clock. */
  hour: number | null;
  stats: { totalPhotos: number; totalLocations: number; totalFaces: number };
  photos: MapPhoto[];
}) {
  const stack = photos.slice(0, 3).reverse(); // newest ends on top
  const chips = [
    { label: "Photos", value: stats.totalPhotos, icon: Camera, gradient: "from-sky-400 to-blue-500" },
    { label: "Places", value: stats.totalLocations, icon: MapPin, gradient: "from-emerald-400 to-teal-500" },
    { label: "Faces", value: stats.totalFaces, icon: Users, gradient: "from-amber-400 to-orange-500" },
  ];
  return (
    <motion.section
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative overflow-hidden rounded-[28px] mb-6 border border-white bg-gradient-to-br from-sky-200/80 via-sky-50 to-indigo-100 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_20px_40px_-20px_rgba(3,105,161,0.35)]"
    >
      <div className="absolute -top-16 -right-12 w-64 h-64 bg-sky-300/40 rounded-full blur-3xl" />
      <div className="absolute -bottom-24 left-1/3 w-72 h-72 bg-indigo-200/50 rounded-full blur-3xl" />
      <div className="absolute top-6 right-1/3 w-32 h-32 bg-pink-200/40 rounded-full blur-2xl" />
      {/* Dotted flight path */}
      <svg className="hidden sm:block absolute right-0 top-0 h-full w-2/3 pointer-events-none opacity-60" viewBox="0 0 400 220" preserveAspectRatio="none" aria-hidden>
        <path d="M-10 190 C 90 120, 160 200, 250 110 S 360 40, 420 30" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="2 9" strokeLinecap="round" />
      </svg>

      <div className="relative flex flex-col sm:flex-row sm:items-center gap-6 px-5 pt-5 pb-6 sm:px-8 sm:py-8">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <AppLogo size="sm" className="shadow-md shadow-blue-300/50" />
            <span className="text-sm font-extrabold tracking-tight text-slate-700">
              Travel<span className="text-blue-500">ries</span>
            </span>
          </div>
          <h1 className="text-[26px] sm:text-4xl leading-[1.15] font-extrabold tracking-tight text-slate-800">
            {hour === null ? "Welcome back" : greetingFor(hour)}
            {name && <>,<br className="sm:hidden" /> <span className="bg-gradient-to-r from-sky-500 to-blue-600 bg-clip-text text-transparent">{name}</span></>}
          </h1>
          <p className="text-slate-500 text-sm sm:text-[15px] mt-2 max-w-md">
            Add your travel photos. We&apos;ll pin them on your map, find the people in them and turn them into trips.
          </p>

          <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-1.5 sm:gap-2 mt-5">
            {chips.map(({ label, value, icon: Icon, gradient }) => (
              <div key={label}
                className="flex items-center gap-1.5 sm:gap-2 bg-white/80 backdrop-blur rounded-full border border-white pl-1 pr-2.5 sm:pl-1.5 sm:pr-3.5 py-1 sm:py-1.5 shadow-sm min-w-0">
                <span className={`w-6 h-6 sm:w-7 sm:h-7 flex-shrink-0 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center shadow-sm`}>
                  <Icon size={13} className="text-white" />
                </span>
                <span className="text-base font-extrabold text-slate-800 leading-none"><AnimatedNumber value={value} /></span>
                <span className="text-[11px] sm:text-xs font-semibold text-slate-500 truncate">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Polaroid stack of the latest photos (hidden on phones to keep the upload box high) */}
        <Link href="/albums" aria-label="Open Albums"
          className="group hidden sm:block relative w-[260px] h-[190px] flex-shrink-0 mr-2">
          {stack.length > 0 ? stack.map((p, i) => {
            const pose = POLAROID_POSES[i + (3 - stack.length)];
            return (
              <motion.div key={p.id}
                initial={{ opacity: 0, y: 30, rotate: 0 }}
                animate={{ opacity: 1, y: pose.y, x: pose.x, rotate: pose.rotate }}
                whileHover={{ y: pose.y - 10, rotate: pose.rotate * 0.4, scale: 1.04 }}
                transition={{ type: "spring", stiffness: 220, damping: 20, delay: 0.15 + i * 0.1 }}
                style={{ zIndex: pose.z }}
                className="absolute left-1/2 top-1/2 -ml-[70px] -mt-[88px] w-[140px] bg-white p-2 pb-7 rounded-md shadow-[0_12px_28px_-10px_rgba(15,23,42,0.45)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.imageUrl} alt="" className="w-full h-[120px] object-cover rounded-sm bg-slate-100" />
                <p className="absolute bottom-1.5 left-2 right-2 text-[10px] font-semibold text-slate-500 truncate">
                  {placeLabel(p) ?? p.fileName}
                </p>
              </motion.div>
            );
          }) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div animate={{ y: [0, -8, 0], rotate: [0, 4, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="w-24 h-24 rounded-[28px] bg-white/80 border border-white shadow-lg flex items-center justify-center">
                <Plane size={40} className="text-sky-500 -rotate-12" />
              </motion.div>
            </div>
          )}
        </Link>
      </div>
    </motion.section>
  );
}

export function LatestTripCard({ trip, memory }: { trip: Trip; memory: TripMemory }) {
  const cover = memory.days.flatMap((d) => d.photos).find((p) => !p.imageUrl.startsWith("data:")) ?? trip.photos[0];
  const thumbs = trip.photos.filter((p) => p.id !== cover.id).slice(0, 3);
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="tv-card overflow-hidden flex flex-col"
    >
      <Link href={`/albums/trip/${tripAnchorId(trip)}`} className="group relative block flex-1 min-h-[300px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cover.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/85 via-slate-900/25 to-transparent" />
        <span className="absolute top-4 left-4 inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-white/20 backdrop-blur-md border border-white/30 rounded-full px-2.5 py-1">
          <Plane size={12} /> Your latest trip
        </span>
        <div className="absolute inset-x-0 bottom-0 p-5">
          {thumbs.length > 0 && (
            <div className="flex -space-x-2 mb-3">
              {thumbs.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.id} src={p.imageUrl} alt="" className="w-10 h-10 rounded-xl object-cover border-2 border-white shadow" />
              ))}
            </div>
          )}
          <h2 className="text-2xl font-extrabold text-white tracking-tight leading-tight">{memory.title}</h2>
          <p className="text-sm text-white/80 font-semibold mt-0.5 flex items-center gap-1.5">
            <CalendarDays size={13} /> {formatTripDates(memory.start, memory.end)}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-xs font-bold text-white/90">
            <span>{memory.dayCount} {memory.dayCount === 1 ? "day" : "days"}</span>
            <span className="opacity-50">·</span>
            <span>{memory.places.length} {memory.places.length === 1 ? "place" : "places"}</span>
            <span className="opacity-50">·</span>
            <span>{memory.photoCount} {memory.photoCount === 1 ? "photo" : "photos"}</span>
            <span className="ml-auto inline-flex items-center gap-1 bg-white text-slate-800 rounded-full px-3 py-1.5 group-hover:bg-sky-50 transition-colors">
              Open trip <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </Link>
    </motion.section>
  );
}

export function RecentMemories({ photos }: { photos: MapPhoto[] }) {
  if (photos.length === 0) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.4 }}
      className="mt-6"
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-lg font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
          <span className="w-7 h-7 rounded-[9px] bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center shadow-sm shadow-rose-200">
            <Images size={14} className="text-white" />
          </span>
          Recent memories
        </h2>
        <Link href="/albums" className="text-sm font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1">
          See all <ArrowRight size={14} />
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x">
        {photos.map((p, i) => (
          <motion.div key={p.id}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.04 }}
            className="snap-start flex-shrink-0"
          >
            <Link href="/albums" className="group block w-36 sm:w-40">
              <div className="relative rounded-2xl overflow-hidden aspect-[4/5] bg-slate-100 shadow-sm group-hover:shadow-md transition-shadow">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.imageUrl} alt={p.fileName} loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/75 to-transparent pt-8 pb-2 px-2.5">
                  <p className="text-xs font-bold text-white truncate">{p.fileName}</p>
                  <p className="text-[10px] text-white/80 truncate flex items-center gap-0.5">
                    <MapPin size={9} className="flex-shrink-0" /> {placeLabel(p) ?? "Unknown place"}
                  </p>
                </div>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}
