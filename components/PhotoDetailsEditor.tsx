"use client";

import { useState } from "react";
import { CalendarDays, MapPin, Search, LocateFixed, Loader2, Check } from "lucide-react";
import { useLang, localeOf } from "@/lib/i18n";
import { MapPhoto } from "@/lib/types";
import { getPhotoDate } from "@/lib/trips";
import { forwardGeocode, reverseGeocode } from "@/lib/uploadHelpers";
import { captureFromDateInput, toDateInputValue, withDay } from "@/lib/manualDate";
import { updatePhotoDetails, PhotoDetailsPatch } from "@/lib/photosApi";

// Albums → photo → "Edit date & place": fixes a saved photo that landed on the
// wrong day (no EXIF date, so it took the upload day) or has no or the wrong place.
// Trips, the map and search all follow, since they are worked out from these fields.
export default function PhotoDetailsEditor({ photo, uid, onSaved, onCancel }: {
  photo: MapPhoto;
  uid: string;
  onSaved: (patch: PhotoDetailsPatch) => void;
  onCancel: () => void;
}) {
  const { t, lang } = useLang();
  const current = getPhotoDate(photo);
  const initialDay = current.getTime() > 0 ? toDateInputValue(current) : "";
  const [day, setDay] = useState(initialDay);
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "searching" | "notfound" | "saving" | "error">("idle");

  async function search() {
    if (!query.trim()) return;
    setStatus("searching");
    const r = await forwardGeocode(query.trim());
    setPlace(r);
    setStatus(r ? "idle" : "notfound");
  }

  function useHere() {
    if (!navigator.geolocation) { setStatus("notfound"); return; }
    setStatus("searching");
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const name = await reverseGeocode(coords.latitude, coords.longitude);
      setPlace({ lat: coords.latitude, lng: coords.longitude, name: name || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}` });
      setStatus("idle");
    }, () => setStatus("notfound"));
  }

  async function save() {
    const patch: PhotoDetailsPatch = {};
    if (day && day !== initialDay) {
      // Keep the hour it was taken when the photo had a real time; else noon.
      const hasTime = !!photo.captureTimestamp && !!photo.captureTime && photo.captureTime !== "Not available";
      const ts = hasTime ? withDay(photo.captureTimestamp!, day) : captureFromDateInput(day)?.captureTimestamp ?? null;
      if (ts) {
        patch.captureTimestamp = ts;
        patch.captureDate = new Date(ts).toLocaleDateString(localeOf(lang));
        if (!hasTime) patch.captureTime = null;
      }
    }
    if (place) { patch.lat = place.lat; patch.lng = place.lng; patch.location = place.name; }
    if (Object.keys(patch).length === 0) { onCancel(); return; }
    setStatus("saving");
    try {
      await updatePhotoDetails(uid, photo.id, patch);
      onSaved(patch);
    } catch (err) {
      console.error("Update photo details failed:", err);
      setStatus("error");
    }
  }

  const busy = status === "searching" || status === "saving";
  return (
    <div className="col-span-2 rounded-xl border border-sky-200 bg-sky-50/60 p-3 space-y-3">
      <div>
        <p className="text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1"><CalendarDays size={12} /> {t("Date taken")}</p>
        <input type="date" value={day} max={toDateInputValue(new Date())} onChange={(e) => setDay(e.target.value)}
          className="w-full text-sm border border-slate-200 bg-white rounded-lg px-3 py-2 outline-none focus:border-sky-400" />
      </div>
      <div>
        <p className="text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1"><MapPin size={12} /> {t("Place")}</p>
        <p className="text-xs text-slate-600 mb-1.5 break-words">
          {place ? <span className="font-semibold text-sky-700">{t("New:")} {place.name}</span> : (photo.location || t("No location"))}
        </p>
        <div className="flex gap-1.5">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder={t("Search a place (e.g. Seongsu, Seoul)")}
            className="flex-1 min-w-0 text-xs border border-slate-200 bg-white rounded-lg px-2.5 py-2 outline-none focus:border-sky-400" />
          <button type="button" onClick={search} disabled={busy} title={t("Search")} className="px-2.5 rounded-lg bg-slate-800 text-white disabled:opacity-50">
            {status === "searching" ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          </button>
          <button type="button" onClick={useHere} disabled={busy} title={t("Use current location")} className="px-2.5 rounded-lg bg-sky-500 text-white disabled:opacity-50">
            <LocateFixed size={14} />
          </button>
        </div>
        {status === "notfound" && <p className="text-[11px] text-red-500 mt-1">{t("Couldn't find that place. Try another search.")}</p>}
      </div>
      {status === "error" && <p className="text-[11px] text-red-500">{t("Couldn't save. Please try again.")}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={status === "saving"} className="px-3 py-1.5 text-xs font-bold text-slate-500">{t("Cancel")}</button>
        <button type="button" onClick={save} disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-sky-500 to-blue-600 disabled:opacity-60">
          {status === "saving" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {t("Save")}
        </button>
      </div>
    </div>
  );
}
