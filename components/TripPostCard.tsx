"use client";

import Link from "next/link";
import { Plane, MapPin, Camera, Users, ChevronRight } from "lucide-react";
import type { TripPostInfo } from "@/lib/socialUtils";
import { useLang } from "@/lib/i18n";

// The body of a trip post in the feed / post page: a photo collage and the trip's
// numbers, linking to the public trip page (map, photos, diary).
export default function TripPostCard({ trip, authorName }: { trip: TripPostInfo; authorName: string }) {
  const { t, tn } = useLang();
  const [a, b, c] = trip.covers;
  // Titles were saved in the poster's language; an English "Sokcho Trip" reads "Sokcho 여행" in Korean.
  const city = trip.title.match(/^(.*) Trip$/)?.[1];
  const title = city ? t("{city} Trip", { city }) : trip.title;
  return (
    <Link href={`/trip/${trip.shareId}`} className="group block">
      <div className="flex gap-0.5 h-64 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a} alt="" className={`h-full object-cover min-w-0 ${b ? "w-2/3" : "w-full"}`} />
        {b && (
          <div className="w-1/3 flex flex-col gap-0.5 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b} alt="" className="w-full flex-1 min-h-0 object-cover" />
            {c ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c} alt="" className="w-full flex-1 min-h-0 object-cover" />
            ) : <div className="flex-1 bg-sky-100" />}
          </div>
        )}
      </div>
      <div className="px-4 pt-3 pb-3 bg-gradient-to-br from-sky-50/80 to-cyan-50/60">
        <p className="text-[11px] font-bold text-sky-600 flex items-center gap-1">
          <Plane size={12} /> {t("{name} shared a trip", { name: authorName })}
        </p>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="font-extrabold text-slate-800 text-lg leading-tight">
            {title} <span className="font-semibold text-slate-400 text-sm">· {tn(trip.days, "{n} day", "{n} days")}</span>
          </p>
          <ChevronRight size={18} className="text-slate-300 group-hover:text-sky-500 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
        </div>
        <p className="text-xs text-slate-400 font-semibold">{trip.dates}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs font-bold text-slate-600">
          <span className="flex items-center gap-1"><MapPin size={13} className="text-sky-500" /> {tn(trip.places, "{n} place", "{n} places")}</span>
          <span className="flex items-center gap-1"><Camera size={13} className="text-sky-500" /> {tn(trip.photos, "{n} photo", "{n} photos")}</span>
          {trip.people > 0 && <span className="flex items-center gap-1"><Users size={13} className="text-sky-500" /> {tn(trip.people, "{n} person", "{n} people")}</span>}
        </div>
        {trip.journey.length > 1 && (
          <p className="text-xs text-slate-500 mt-2 truncate">{trip.journey.join(" → ")}</p>
        )}
      </div>
    </Link>
  );
}
