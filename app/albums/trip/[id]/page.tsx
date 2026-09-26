"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import SectionTabs from "@/components/SectionTabs";
import TripView from "@/components/TripView";
import { getSessionUser } from "@/lib/supabase";
import { fetchMapPhotos, fetchFacePhotos } from "@/lib/photosApi";
import { fetchPeople, Person } from "@/lib/peopleApi";
import { detectTrips, Trip } from "@/lib/trips";
import { FacePhoto } from "@/lib/types";

// One trip, named in the URL by any of its photos (Albums links the earliest,
// lib/tripMemory.ts tripAnchorId). Trips aren't stored; they're re-detected here.
export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const [uid, setUid] = useState<string | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [facePhotos, setFacePhotos] = useState<FacePhoto[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await getSessionUser();
      if (!user) { setLoading(false); return; }
      setUid(user.id);
      const found = detectTrips(await fetchMapPhotos(user.id)).find((t) => t.photos.some((p) => p.id === id)) ?? null;
      setTrip(found);
      setLoading(false);
      if (found) {
        const [faces, ppl] = await Promise.all([fetchFacePhotos(user.id), fetchPeople(user.id)]);
        setFacePhotos(faces);
        setPeople(ppl);
      }
    })();
  }, [id]);

  return (
    <main className="min-h-screen px-4 sm:px-6 pt-16 xl:pt-8 pb-24 lg:pb-10">
      <div className="max-w-3xl mx-auto">
        <SectionTabs section="albums" active="trips" />
        {loading ? (
          <>
            <div className="tv-card h-64 animate-pulse" />
            <div className="tv-card h-12 mt-4 animate-pulse" />
            <div className="tv-card h-72 mt-4 animate-pulse" />
          </>
        ) : trip ? (
          <TripView trip={trip} facePhotos={facePhotos} people={people} uid={uid} />
        ) : (
          <div className="tv-card p-10 text-center">
            <p className="font-bold text-slate-700">This trip isn&apos;t available.</p>
            <p className="text-sm text-slate-400 mt-1">Its photos may have been deleted.</p>
            <Link href="/albums?view=trips" className="tv-btn-soft text-sm px-4 py-2 mt-4 inline-flex">
              <ArrowLeft size={14} /> All trips
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
