"use client";

import { ChangeEvent, Fragment, useState, useEffect, useRef } from "react";
import * as exifr from "exifr";
import * as faceapi from "face-api.js";
import { loadMediaPipeDetector } from "@/lib/mediapipeDetector";
import { flyPaperPlane } from "@/lib/paperPlane";
import { getSessionUser } from "@/lib/supabase";
import { MapPhoto, FacePhoto } from "@/lib/types";
import { fetchAllPhotos, fetchMapPhotos, upsertPhoto, renamePhoto, uploadToUserPhotos, migrateInlineImages, pruneOrphanPeople } from "@/lib/photosApi";
import { fetchPeople, createPerson, Person } from "@/lib/peopleApi";
import {
  Camera, Upload, MapPin, Users, CalendarDays, Clock,
  FileImage, Ruler, CheckCircle2, Loader2,
  Search, Navigation, X, Check,
  Coffee, Utensils, Wine, Sparkles, Trash2, ScanFace, Save, Pencil,
} from "lucide-react";
import Link from "next/link";
import { HomeHero, LatestTripCard, RecentMemories } from "@/components/HomeSections";
import { detectTrips, Trip } from "@/lib/trips";
import { summarizeTrip, TripMemory } from "@/lib/tripMemory";
import { fetchProfile } from "@/lib/socialUtils";
import BatchUploadPanel, { BatchFile, BatchPhase } from "@/components/BatchUploadPanel";
import { guessLocationByTime, describeGap, LocatedShot } from "@/lib/locationGuess";
import { msg, useLang, localeOf } from "@/lib/i18n";
import { captureFromDateInput, toDateInputValue } from "@/lib/manualDate";
import { BACKEND_URL } from "@/lib/backend";
import { newId } from "@/lib/id";
import { runFaceDetection, DetectionResult } from "@/lib/faceDetection";
import { isFaceAnalysisEnabled } from "@/lib/faceSettings";
import { toDisplayableImage } from "@/lib/heic";
import {
  NearbyPlace, formatBytes, createThumbnailDataUrl, cropFaceThumbnails,
  reverseGeocode, forwardGeocode, fetchNearbyPlaces, analyzeWithBackend,
} from "@/lib/uploadHelpers";

// ── Types ──────────────────────────────────────


type PhotoInfo = {
  fileName: string;
  fileType: string;
  fileSize: string;
  uploadedAt: string;
  captureDate: string;
  captureTime: string;
  captureTimestamp: string | null;
  location: string;
  lat: number | null;
  lng: number | null;
  faceCount: number;
  category: string;
  faceBoxes: Array<{ x: number; y: number; width: number; height: number }>;
};



// ── InfoRow — all icons sky blue ──────────────────────────
function InfoRow({ label, value, icon: Icon }: {
  label: string;
  value: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="bg-white rounded-xl px-3 py-3 border border-slate-100 flex items-start gap-2.5 shadow-sm">
      {Icon && (
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-sky-50 border border-sky-100">
          <Icon size={15} className="text-sky-500" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-slate-400 font-medium mb-0.5">{label}</p>
        <p className="text-sm font-bold text-slate-800 break-all leading-snug">{value}</p>
      </div>
    </div>
  );
}

// GPS + capture time read in the browser. A HEIC converted to JPEG (lib/heic.ts)
// loses its EXIF, so the backend can't read it from the upload — this reads the original.
async function readExifInBrowser(file: File) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exifData: any = await exifr.parse(file).catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gpsData:  any = await exifr.gps(file).catch(() => null);
  const lat = typeof gpsData?.latitude  === "number" ? (gpsData.latitude as number)  : null;
  const lng = typeof gpsData?.longitude === "number" ? (gpsData.longitude as number) : null;
  const takenAt = exifData?.DateTimeOriginal || exifData?.CreateDate || null;
  const d = takenAt ? new Date(takenAt) : null;
  const location = lat !== null && lng !== null
    ? (await reverseGeocode(lat, lng)) || `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    : null;
  return {
    lat, lng, location,
    captureDate: d ? d.toLocaleDateString() : null,
    captureTime: d ? d.toLocaleTimeString() : null,
    captureTimestamp: d ? d.toISOString() : null,
  };
}

// Who? menu value that names a new person (see createPersonByName).
const NEW_PERSON = "__new__";

// ── Main Component ──────────────────────────────
export default function HomePage() {
  const uploadRequestIdRef = useRef(0);
  const { t, tn, lang } = useLang();
  // Mirrors customFileName synchronously — handleSave reads this instead of
  // the raw File.name so its DB write always carries whatever name is showing at
  // the moment it actually executes, even if the user renamed while face
  // detection (which can take a couple of seconds) was still running. React state
  // alone can't do this: handleSave's closure would only see the value of
  // customFileName from when it was called, not any rename typed afterward.
  const customFileNameRef = useRef("");
  // Similarly a ref, not state — handleSave reserves this id SYNCHRONOUSLY (before
  // its own await), so a double tap or a rename racing the save reuses the same
  // row instead of minting a second id (with useState both would see the old value).
  const lastFacePhotoIdRef = useRef<string | null>(null);
  const [selectedFile,   setSelectedFile]   = useState<File | null>(null);
  const [previewUrl,     setPreviewUrl]     = useState("");
  const [photoInfo,      setPhotoInfo]      = useState<PhotoInfo | null>(null);
  const [loading,        setLoading]        = useState(false);
  const [savedMessage,   setSavedMessage]   = useState("");
  const [uploadError,    setUploadError]    = useState("");
  const [customFileName, setCustomFileName] = useState("");
  const [draftFileName,  setDraftFileName]  = useState("");
  const [isEditingName,  setIsEditingName]  = useState(false);
  const [isModelLoaded,  setIsModelLoaded]  = useState(false);
  const [hasExtraModels, setHasExtraModels] = useState(false);
  // Profile → Face analysis. Off: no face detection runs and no face data is saved.
  const [faceAnalysisOn, setFaceAnalysisOn] = useState(true);
  const [modelType,      setModelType]      = useState<"mediapipe" | "ssd" | "tiny">("tiny");
  const [backendStatus,  setBackendStatus]  = useState<"checking" | "online" | "offline">("checking");
  const [locationQuery,  setLocationQuery]  = useState("");
  const [manualCoords,   setManualCoords]   = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "searching" | "done" | "error">("idle");
  const [nearbyPlaces,     setNearbyPlaces]     = useState<NearbyPlace[]>([]);
  const [placesLoading,    setPlacesLoading]    = useState(false);
  const [placesFetched,    setPlacesFetched]    = useState(false);
  const [dashStats,        setDashStats]        = useState({ totalPhotos: 0, totalLocations: 0, totalFaces: 0 });
  const [recentPhotos,     setRecentPhotos]     = useState<MapPhoto[]>([]);
  const [latestTrip,       setLatestTrip]       = useState<{ trip: Trip; memory: TripMemory } | null>(null);
  const [userName,         setUserName]         = useState<string | null>(null);
  const [hour,             setHour]             = useState<number | null>(null);
  const [batchItems,       setBatchItems]       = useState<BatchFile[]>([]);
  const [batchActive,      setBatchActive]      = useState(false);
  const [batchPhase,       setBatchPhase]       = useState<BatchPhase>("analyzing");
  const [isMapSaved,       setIsMapSaved]       = useState(false);
  const [rawFaces,           setRawFaces]           = useState<{
    boxes: DetectionResult["boxes"]; descriptors: number[][]; confidences: number[];
    ages: number[]; genders: string[]; expressions: string[];
  } | null>(null);
  const [selectedFaceIndices, setSelectedFaceIndices] = useState<Set<number>>(new Set());
  const [saving,              setSaving]              = useState(false);
  const [locationNote,        setLocationNote]        = useState<string | null>(null);
  // "YYYY-MM-DD" picked for a photo with no EXIF date (see lib/manualDate.ts).
  const [manualDate,          setManualDate]          = useState("");
  const [faceThumbnails,      setFaceThumbnails]      = useState<string[]>([]);
  const [people,              setPeople]              = useState<Person[]>([]);
  const [faceAssignments,     setFaceAssignments]     = useState<Record<number, string>>({});

  async function refreshStats() {
    const { data: { user } } = await getSessionUser();
    const uid = user?.id ?? "guest";
    // One round trip for both lists (was two full-table fetches).
    const { mapPhotos, facePhotos }: { mapPhotos: MapPhoto[]; facePhotos: FacePhoto[] } =
      uid === "guest" ? { mapPhotos: [], facePhotos: [] } : await fetchAllPhotos(uid);
    const locationSet = new Set(
      mapPhotos.map((p) => p.location?.split(",")[0]?.trim()).filter(Boolean)
    );
    const totalFaces = facePhotos.reduce((sum, p) => sum + (p.faceCount ?? 0), 0);
    setDashStats({ totalPhotos: mapPhotos.length, totalLocations: locationSet.size, totalFaces });
    setRecentPhotos(mapPhotos.filter((p) => !p.imageUrl.startsWith("data:")).slice(0, 12));
    const trip = detectTrips(mapPhotos)[0]; // newest first
    setLatestTrip(trip ? { trip, memory: summarizeTrip(trip) } : null);
  }

  useEffect(() => {
    refreshStats();
    isFaceAnalysisEnabled().then(setFaceAnalysisOn);
    setHour(new Date().getHours()); // after mount: the server's clock isn't the viewer's
    (async () => {
      const { data: { user } } = await getSessionUser();
      const uid = user?.id ?? "guest";
      if (uid === "guest") return;
      fetchProfile(uid).then((profile) => {
        const name = profile?.name || (user?.user_metadata?.name as string | undefined) || user?.email?.split("@")[0];
        setUserName(name ? name.split(" ")[0] : null);
      });
      await pruneOrphanPeople(uid).catch(() => 0); // names whose photos were all deleted
      setPeople(await fetchPeople(uid));
      // Background, non-blocking: move any old inline-base64 images to Storage.
      if ((await migrateInlineImages(uid)) > 0) refreshStats();
    })();
  }, []);

  useEffect(() => {
    const MODEL_URL = "/models";

    function loadExtras() {
      Promise.all([
        faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
      ]).then(() => setHasExtraModels(true)).catch(() => {});
    }

    function loadSsdFallback() {
      Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]).then(() => {
        setModelType("ssd");
        setIsModelLoaded(true);
        loadExtras();
      }).catch(() => {
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)
          .then(() => { setModelType("tiny"); setIsModelLoaded(true); })
          .catch((err) => console.error("AI model load failed", err));
      });
    }

    Promise.all([
      loadMediaPipeDetector(),
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]).then(() => {
      setModelType("mediapipe");
      setIsModelLoaded(true);
      loadExtras();
      // SSD: runFaceDetection's second opinion for faces MediaPipe loses (cut off
      // at the frame edge, turned to the side). Optional — used once loaded.
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL).catch(() => {});
    }).catch(() => {
      loadSsdFallback();
    });
  }, []);

  useEffect(() => {
    fetch(`${BACKEND_URL}/health`)
      .then((r) => setBackendStatus(r.ok ? "online" : "offline"))
      .catch(() => setBackendStatus("offline"));
  }, []);

  async function finalizeFaceUpload(
    file: File,
    requestId: number,
    info: {
      lat: number | null; lng: number | null;
      captureDate: string; captureTime: string; captureTimestamp: string | null;
      location: string;
      detectedFaceCount: number;
      faceBoxes: Array<{ x: number; y: number; width: number; height: number }>;
      faceDescriptors: number[][];
      faceConfidences: number[];
      faceAges: number[];
      faceGenders: string[];
      faceExpressions: string[];
    }
  ) {
    const {
      lat, lng, captureDate, captureTime, captureTimestamp, location,
      detectedFaceCount, faceBoxes, faceDescriptors, faceConfidences,
      faceAges, faceGenders, faceExpressions,
    } = info;

    // A newer file was selected while this one was still being analyzed — drop this
    // stale result instead of overwriting the preview/analysis panel for the new file.
    if (requestId !== uploadRequestIdRef.current) return;

    const category = detectedFaceCount > 0 ? msg("Portrait") : msg("Scenery");
    setPhotoInfo({
      fileName: file.name, fileType: file.type || "unknown",
      fileSize: formatBytes(file.size), uploadedAt: new Date().toLocaleString(),
      captureDate, captureTime, captureTimestamp, location, lat, lng,
      faceCount: detectedFaceCount, category, faceBoxes,
    });

    if (lat !== null && lng !== null && backendStatus === "online") {
      setPlacesLoading(true);
      fetchNearbyPlaces(lat, lng).then((places) => {
        setNearbyPlaces(places);
        setPlacesFetched(true);
        setPlacesLoading(false);
      });
    }

    const faces = {
      boxes: faceBoxes, descriptors: faceDescriptors, confidences: faceConfidences,
      ages: faceAges, genders: faceGenders, expressions: faceExpressions,
    };
    setRawFaces(faces);

    // Nothing is saved yet: every face starts picked, and the one Save button
    // (handleSave) writes the photo, its place and the picked faces together.
    setSelectedFaceIndices(new Set(faceBoxes.map((_, i) => i)));
    setFaceThumbnails([]);
    if (detectedFaceCount > 0) {
      cropFaceThumbnails(file, faceBoxes).then(setFaceThumbnails).catch(() => setFaceThumbnails([]));
    }

    // No GPS: borrow the place of the saved photo taken closest in time, like batch upload.
    if (lat === null && captureTimestamp) {
      const { data: { user } } = await getSessionUser();
      if (!user) return;
      const shots: LocatedShot[] = (await fetchMapPhotos(user.id).catch(() => []))
        .filter((p) => p.lat != null && p.lng != null && p.captureTimestamp)
        .map((p) => ({ takenAt: p.captureTimestamp!, lat: p.lat!, lng: p.lng!, location: p.location, label: p.fileName }));
      const guess = guessLocationByTime(captureTimestamp, shots);
      if (guess && requestId === uploadRequestIdRef.current) {
        setManualCoords({ lat: guess.lat, lng: guess.lng, name: guess.location ?? `${guess.lat.toFixed(5)}, ${guess.lng.toFixed(5)}` });
        setLocationStatus("done");
        setLocationNote(t("Estimated from {label}, taken {gap}", { label: guess.label, gap: describeGap(guess.gapMs, t) }));
      }
    }
  }

  function toggleFaceSelection(index: number) {
    if (isMapSaved) return;
    setSelectedFaceIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // so picking the same photo again still fires onChange
    if (files.length === 0) return;
    setUploadError("");
    if (files.length > 1) { processBatch(files); return; }
    const original = files[0];
    const requestId = ++uploadRequestIdRef.current;
    setLoading(true);
    let file: File;
    try {
      file = await toDisplayableImage(original);
    } catch (err) {
      console.error("Couldn't convert HEIC:", err);
      setUploadError(t("Couldn't open “{name}”. Try exporting it as JPG and uploading again.", { name: original.name }));
      setLoading(false);
      return;
    }
    if (requestId !== uploadRequestIdRef.current) return;

    setSavedMessage("");
    setManualCoords(null);
    setLocationQuery("");
    setLocationStatus("idle");
    lastFacePhotoIdRef.current = null;
    setNearbyPlaces([]);
    setPlacesFetched(false);
    setIsMapSaved(false);
    setRawFaces(null);
    setSelectedFaceIndices(new Set());
    setLocationNote(null);
    setManualDate("");
    setFaceThumbnails([]);
    setFaceAssignments({});
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setCustomFileName(file.name);
    customFileNameRef.current = file.name;
    setDraftFileName(file.name);
    setIsEditingName(false);
    setLoading(true);

    try {
      let lat: number | null = null;
      let lng: number | null = null;
      let captureDate = "Not available";
      let captureTime = "Not available";
      let captureTimestamp: string | null = null;
      let location    = "No GPS data";
      let detectedFaceCount = 0;
      let faceBoxes: Array<{ x: number; y: number; width: number; height: number }> = [];
      let faceDescriptors: number[][] = [];
      let faceConfidences: number[] = [];
      let faceAges: number[] = [];
      let faceGenders: string[] = [];
      let faceExpressions: string[] = [];

      if (backendStatus === "online") {
        const data = await analyzeWithBackend(file, faceAnalysisOn);
        lat           = data.latitude   ?? null;
        lng           = data.longitude  ?? null;
        captureDate   = data.captureDate ?? "Not available";
        captureTime   = data.captureTime ?? "Not available";
        captureTimestamp = data.captureDate && data.captureTime
          ? new Date(`${data.captureDate}T${data.captureTime}`).toISOString()
          : null;
        location      = data.location ?? (lat !== null ? `${lat.toFixed(6)}, ${lng?.toFixed(6)}` : "No GPS data");
        detectedFaceCount = data.faceCount ?? 0;
        faceBoxes         = (data.faceBoxes ?? []).map((b) => ({ x: b.x_norm, y: b.y_norm, width: b.w_norm, height: b.h_norm }));
        faceDescriptors   = data.descriptors ?? [];
        faceConfidences   = (data.confidences ?? []).map(Number);
        faceAges          = (data.ages ?? []).filter((a): a is number => a !== null);
        faceGenders       = (data.genders ?? []).filter((g): g is string => g !== null);
        if (file !== original && lat === null) {
          // Converted HEIC: the JPEG sent to the backend has no EXIF, so read the original here.
          const ex = await readExifInBrowser(original);
          lat = ex.lat; lng = ex.lng;
          if (ex.location) location = ex.location;
          if (ex.captureTimestamp) {
            captureDate = ex.captureDate!; captureTime = ex.captureTime!; captureTimestamp = ex.captureTimestamp;
          }
        }
        // Temporary diagnostics for tuning the backend's det_thresh — if a face
        // gets wrongly detected (or a real one missed), check this in devtools
        // to see the confidence score and normalized box InsightFace actually
        // returned for it, rather than guessing at the threshold blind.
        console.log(`[API mode] ${detectedFaceCount} face(s) detected`, faceBoxes.map((b, i) => ({
          confidence: faceConfidences[i], x: b.x.toFixed(3), y: b.y.toFixed(3), w: b.width.toFixed(3), h: b.height.toFixed(3),
        })));
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const exifData: any = await exifr.parse(original).catch(() => null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gpsData:  any = await exifr.gps(original).catch(() => null);
        lat = typeof gpsData?.latitude  === "number" ? gpsData.latitude  : null;
        lng = typeof gpsData?.longitude === "number" ? gpsData.longitude : null;
        const takenAt = exifData?.DateTimeOriginal || exifData?.CreateDate || null;
        if (takenAt) {
          const d = new Date(takenAt);
          captureDate = d.toLocaleDateString();
          captureTime = d.toLocaleTimeString();
          captureTimestamp = d.toISOString();
        }
        if (lat !== null && lng !== null) {
          const addr = await reverseGeocode(lat, lng);
          location = addr || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        }
        if (isModelLoaded && faceAnalysisOn) {
          const imgEl = await faceapi.fetchImage(URL.createObjectURL(file));
          const r = await runFaceDetection(imgEl, modelType, hasExtraModels);
          detectedFaceCount = r.count;
          faceBoxes         = r.boxes;
          faceDescriptors   = r.descriptors;
          faceConfidences   = r.confidences;
          faceAges          = r.ages;
          faceGenders       = r.genders;
          faceExpressions   = r.expressions;
        }
      }

      await finalizeFaceUpload(file, requestId, {
        lat, lng, captureDate, captureTime, captureTimestamp, location,
        detectedFaceCount, faceBoxes, faceDescriptors, faceConfidences, faceAges, faceGenders, faceExpressions,
      });
    } catch (err) {
      console.error(err);
      if (requestId === uploadRequestIdRef.current) {
        setUploadError(t("Something went wrong while reading this photo: {error}", { error: err instanceof Error ? err.message : String(err) }));
      }
    } finally {
      if (requestId === uploadRequestIdRef.current) setLoading(false);
    }
  }

  async function handleLocationSearch() {
    if (!locationQuery.trim()) return;
    setLocationStatus("searching");
    const result = await forwardGeocode(locationQuery.trim());
    if (result) {
      setManualCoords(result);
      setLocationNote(null);
      setLocationStatus("done");
      if (backendStatus === "online") {
        setPlacesLoading(true);
        setNearbyPlaces([]);
        setPlacesFetched(false);
        fetchNearbyPlaces(result.lat, result.lng).then((places) => {
          setNearbyPlaces(places);
          setPlacesFetched(true);
          setPlacesLoading(false);
        });
      }
    } else {
      setLocationStatus("error");
    }
  }

  function handleCurrentLocation() {
    if (!navigator.geolocation) { alert(t("Geolocation is not supported by your browser.")); return; }
    setLocationStatus("searching");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const name = await reverseGeocode(lat, lng);
        setManualCoords({ lat, lng, name: name || `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
        setLocationNote(null);
        setLocationStatus("done");
        if (backendStatus === "online") {
          setPlacesLoading(true);
          setNearbyPlaces([]);
          setPlacesFetched(false);
          fetchNearbyPlaces(lat, lng).then((places) => {
            setNearbyPlaces(places);
            setPlacesFetched(true);
            setPlacesLoading(false);
          });
        }
      },
      () => { alert(t("Unable to retrieve your location.")); setLocationStatus("error"); }
    );
  }

  // Batch step 1: analyze every file but save nothing — the panel then lets the
  // user open each photo's analysis, pick and tag faces, and press Save (saveBatch).
  async function processBatch(files: File[]) {
    batchItems.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl));
    setBatchActive(true);
    setBatchPhase("analyzing");
    const items: BatchFile[] = files.map((f) => ({
      name: f.name, status: "pending", info: "",
      boxes: [], descriptors: [], confidences: [], selectedFaces: [], personIds: {},
    }));
    setBatchItems([...items]);

    for (let i = 0; i < files.length; i++) {
      const original = files[i];
      items[i] = { ...items[i], status: "processing" };
      setBatchItems([...items]);
      try {
        const file = await toDisplayableImage(original);
        let lat: number | undefined;
        let lng: number | undefined;
        let captureDate: string | undefined;
        let captureTime: string | undefined;
        let captureTimestamp: string | undefined;
        let location:    string | undefined;
        let faceCount = 0;
        let faceBoxes:    Array<{ x: number; y: number; width: number; height: number }> = [];
        let faceDescriptors: number[][] = [];
        let faceConfs:    number[] = [];

        // Same backend/browser split as the single-photo upload path (handleFileChange)
        // — batch upload used to always run browser-mode face detection even with the
        // backend online, silently giving batch uploads worse accuracy than single ones.
        if (backendStatus === "online") {
          const data = await analyzeWithBackend(file, faceAnalysisOn);
          lat = data.latitude ?? undefined;
          lng = data.longitude ?? undefined;
          captureDate = data.captureDate ?? undefined;
          captureTime = data.captureTime ?? undefined;
          captureTimestamp = data.captureDate && data.captureTime
            ? new Date(`${data.captureDate}T${data.captureTime}`).toISOString()
            : undefined;
          location = data.location ?? (lat !== undefined ? `${lat.toFixed(6)}, ${lng?.toFixed(6)}` : undefined);
          faceCount       = data.faceCount ?? 0;
          faceBoxes       = (data.faceBoxes ?? []).map((b) => ({ x: b.x_norm, y: b.y_norm, width: b.w_norm, height: b.h_norm }));
          faceDescriptors = data.descriptors ?? [];
          faceConfs       = (data.confidences ?? []).map(Number);
          if (file !== original && lat === undefined) {
            const ex = await readExifInBrowser(original);
            lat = ex.lat ?? undefined; lng = ex.lng ?? undefined;
            location = ex.location ?? location;
            captureDate = ex.captureDate ?? captureDate; captureTime = ex.captureTime ?? captureTime;
            captureTimestamp = ex.captureTimestamp ?? captureTimestamp;
          }
          console.log(`[API mode][batch] ${file.name}: ${faceCount} face(s) detected`, faceBoxes.map((b, j) => ({
            confidence: faceConfs[j], x: b.x.toFixed(3), y: b.y.toFixed(3), w: b.width.toFixed(3), h: b.height.toFixed(3),
          })));
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const exifData: any = await exifr.parse(original).catch(() => null);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const gpsData:  any = await exifr.gps(original).catch(() => null);
          lat = typeof gpsData?.latitude  === "number" ? gpsData.latitude  : undefined;
          lng = typeof gpsData?.longitude === "number" ? gpsData.longitude : undefined;
          const takenAt = exifData?.DateTimeOriginal || exifData?.CreateDate || null;
          if (takenAt) {
            const d = new Date(takenAt);
            captureDate = d.toLocaleDateString();
            captureTime = d.toLocaleTimeString();
            captureTimestamp = d.toISOString();
          }
          if (lat !== undefined && lng !== undefined) {
            const addr = await reverseGeocode(lat, lng);
            location = addr || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
          }
          if (isModelLoaded && faceAnalysisOn) {
            const imgEl = await faceapi.fetchImage(URL.createObjectURL(file));
            const r = await runFaceDetection(imgEl, modelType, hasExtraModels);
            faceCount       = r.count;
            faceBoxes       = r.boxes;
            faceDescriptors = r.descriptors;
            faceConfs       = r.confidences;
          }
        }
        const infoParts: string[] = [];
        if (faceCount > 0) infoParts.push(tn(faceCount, "{n} face", "{n} faces"));
        infoParts.push(location ? location.split(",")[0] : t("No GPS"));
        items[i] = {
          ...items[i],
          name: file.name,
          status: "ready",
          info: infoParts.join(" · "),
          file,
          previewUrl: URL.createObjectURL(file),
          fileSize: formatBytes(file.size),
          location, captureDate, captureTime, captureTimestamp, lat, lng,
          locationSource: lat !== undefined && lng !== undefined ? "gps" : undefined,
          boxes: faceBoxes,
          descriptors: faceDescriptors,
          confidences: faceConfs,
          selectedFaces: faceBoxes.map((_, j) => j),
          editName: file.name,
        };
      } catch (err) {
        console.error(`Batch error [${original.name}]:`, err);
        items[i] = { ...items[i], status: "error", info: t("Couldn't read this photo") };
      }
      setBatchItems([...items]);
    }
    await guessMissingLocations(items);
    setBatchItems([...items]);
    setBatchPhase("review");
  }

  // Photos without GPS get the place of the located photo taken closest in time —
  // from this batch first, else from the user's saved map photos — so they still
  // land on the map. The review modal shows it as an estimate the user can change.
  async function guessMissingLocations(items: BatchFile[]) {
    const missing = items.filter((it) => it.status === "ready" && it.lat === undefined);
    if (missing.length === 0) return;
    const shots: LocatedShot[] = items
      .filter((it) => it.status === "ready" && it.locationSource === "gps" && it.captureTimestamp)
      .map((it) => ({ takenAt: it.captureTimestamp!, lat: it.lat!, lng: it.lng!, location: it.location, label: it.editName ?? it.name }));
    const { data: { user } } = await getSessionUser();
    if (user) {
      try {
        for (const p of await fetchMapPhotos(user.id)) {
          if (p.lat != null && p.lng != null && p.captureTimestamp) {
            shots.push({ takenAt: p.captureTimestamp, lat: p.lat, lng: p.lng, location: p.location, label: p.fileName });
          }
        }
      } catch { /* the batch's own photos are still used */ }
    }
    for (const it of missing) {
      const guess = guessLocationByTime(it.captureTimestamp, shots);
      if (!guess) continue;
      const i = items.indexOf(it);
      items[i] = {
        ...it,
        lat: guess.lat, lng: guess.lng,
        location: guess.location ?? `${guess.lat.toFixed(6)}, ${guess.lng.toFixed(6)}`,
        locationSource: "estimated",
        locationNote: t("Estimated from {label}, taken {gap}", { label: guess.label, gap: describeGap(guess.gapMs, t) }),
      };
    }
  }

  // Batch step 2: save the reviewed photos — only the faces left selected, with
  // any "Who?" tags (index-aligned with boxes, like handleSave).
  async function saveBatch() {
    setBatchPhase("saving");
    const items = [...batchItems];
    const { data: { user } } = await getSessionUser();
    const uid = user?.id;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.status !== "ready" || it.skip || !it.file) continue;
      items[i] = { ...it, status: "saving" };
      setBatchItems([...items]);
      try {
        if (!uid) throw new Error("Not signed in");
        const idx = it.selectedFaces;
        const boxes       = idx.map((j) => it.boxes[j]);
        const descriptors = idx.map((j) => it.descriptors[j]).filter((d): d is number[] => !!d);
        const confidences = idx.map((j) => it.confidences[j]).filter((c): c is number => c !== undefined);
        const personIds   = idx.map((j) => it.personIds[j] ?? null);
        // Kept on the item, so a retry after a failed upsert reuses the same row.
        const photoId = it.photoId ?? newId();
        items[i] = { ...items[i], photoId };
        const dataUrl = await createThumbnailDataUrl(it.file, 1024, 0.90);
        const imageUrl = await uploadToUserPhotos(uid, photoId, dataUrl);
        await upsertPhoto(uid, {
          id: photoId,
          fileName: it.editName?.trim() || it.name,
          imageUrl,
          lat: it.lat, lng: it.lng, location: it.location,
          captureDate: it.captureDate, captureTime: it.captureTime, captureTimestamp: it.captureTimestamp,
          faceCount: boxes.length,
          isMapPhoto: true,
          isFacePhoto: boxes.length > 0,
          ...(boxes.length > 0       && { boxes }),
          ...(descriptors.length > 0 && { descriptors }),
          ...(confidences.length > 0 && { confidences }),
          ...(personIds.some((p) => p !== null) && { personIds }),
        });
        items[i] = { ...items[i], status: "done" };
      } catch (err) {
        console.error(`Batch save error [${it.name}]:`, err);
        items[i] = { ...items[i], status: "error", info: t("Couldn't save") };
      }
      setBatchItems([...items]);
    }
    setBatchPhase("done");
    refreshStats();
    if (items.some((it) => it.status === "done")) flyPaperPlane();
  }

  function resetBatch() {
    batchItems.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl));
    setBatchActive(false);
    setBatchItems([]);
  }

  function clearSelection() {
    setSelectedFile(null);
    setPreviewUrl("");
    setPhotoInfo(null);
    setCustomFileName("");
    customFileNameRef.current = "";
    setDraftFileName("");
    setSavedMessage("");
    setManualCoords(null);
    setLocationStatus("idle");
    lastFacePhotoIdRef.current = null;
    setNearbyPlaces([]);
    setPlacesFetched(false);
    setIsMapSaved(false);
    setRawFaces(null);
    setSelectedFaceIndices(new Set());
    setLocationNote(null);
    setManualDate("");
    setFaceThumbnails([]);
    setFaceAssignments({});
  }

  function startEditName() { setDraftFileName(customFileName); setIsEditingName(true); }
  async function saveEditedName() {
    const newName = draftFileName.trim();
    if (newName) {
      setCustomFileName(newName);
      customFileNameRef.current = newName;
      if (lastFacePhotoIdRef.current) {
        const { data: { user } } = await getSessionUser();
        const uid = user?.id ?? "guest";
        if (uid !== "guest") await renamePhoto(uid, lastFacePhotoIdRef.current, newName);
      }
    }
    setIsEditingName(false);
  }

  // The single Save: the photo (Albums), its place (Map, when it has one) and the
  // picked faces with their "Who?" tags (People), in one row. Boxes, descriptors,
  // confidences and person ids stay index-aligned through the same `indices`.
  // Age, gender and expression are not saved: the estimates were often wrong.
  async function handleSave() {
    if (!selectedFile || !photoInfo || !rawFaces || isMapSaved || saving) return;
    const lat = photoInfo.lat ?? manualCoords?.lat ?? null;
    const lng = photoInfo.lng ?? manualCoords?.lng ?? null;
    const indices     = Array.from(selectedFaceIndices).sort((a, b) => a - b);
    const boxes       = indices.map((i) => rawFaces.boxes[i]);
    const descriptors = indices.map((i) => rawFaces.descriptors[i]).filter((d): d is number[] => !!d);
    const confidences = indices.map((i) => rawFaces.confidences[i]).filter((c): c is number => c !== undefined);
    const personIds   = indices.map((i) => faceAssignments[i] ?? null);
    const location    = manualCoords?.name ?? (photoInfo.location !== "No GPS data" ? photoInfo.location : undefined);

    const photoId = lastFacePhotoIdRef.current ?? newId();
    lastFacePhotoIdRef.current = photoId;
    setSaving(true);
    try {
      const { data: { user } } = await getSessionUser();
      if (!user) throw new Error("Not signed in");
      const dataUrl  = await createThumbnailDataUrl(selectedFile, 1024, 0.90);
      const imageUrl = await uploadToUserPhotos(user.id, photoId, dataUrl);
      await upsertPhoto(user.id, {
        id: photoId,
        fileName: customFileNameRef.current.trim() || selectedFile.name,
        imageUrl,
        ...(lat !== null && lng !== null && { lat, lng }),
        ...(location && { location }),
        ...(() => {
          // No EXIF date: the day picked in the date box, else (as before) none,
          // and the photo falls back to its upload time.
          const picked = !photoInfo.captureTimestamp ? captureFromDateInput(manualDate, localeOf(lang)) : null;
          if (picked) return { captureDate: picked.captureDate, captureTime: null, captureTimestamp: picked.captureTimestamp };
          return {
            captureDate: photoInfo.captureDate !== "Not available" ? photoInfo.captureDate : null,
            captureTime: photoInfo.captureTime !== "Not available" ? photoInfo.captureTime : null,
            captureTimestamp: photoInfo.captureTimestamp,
          };
        })(),
        faceCount: boxes.length,
        isMapPhoto: true,
        isFacePhoto: boxes.length > 0,
        ...(boxes.length > 0       && { boxes }),
        ...(descriptors.length > 0 && { descriptors }),
        ...(confidences.length > 0 && { confidences }),
        ...(personIds.some((p) => p !== null) && { personIds }),
      });
      setIsMapSaved(true);
      setSavedMessage(t("Saved to {places}!", { places: joinPlaces([msg("Albums"), ...(lat !== null ? [msg("Map")] : []), ...(boxes.length > 0 ? [msg("People")] : [])]) }));
      refreshStats();
      flyPaperPlane();
    } catch (err) {
      console.error("Save failed:", err);
      setSavedMessage(t("Save failed: {error}", { error: err instanceof Error ? err.message : t("Please try again.") }));
    } finally {
      setSaving(false);
    }
  }

  // "+ New person" in a face's Who? menu: name someone the People page hasn't
  // met yet, right at upload, so the face is saved straight into them instead of
  // being left to automatic grouping (which can put it with the wrong person).
  // A person whose photo then isn't saved is cleaned up by pruneOrphanPeople.
  async function createPersonByName(): Promise<Person | null> {
    const name = window.prompt(t("Name for this person"))?.trim();
    if (!name) return null;
    const existing = people.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const { data: { user } } = await getSessionUser();
    if (!user) return null;
    try {
      const created = await createPerson(user.id, name);
      setPeople((prev) => [...prev, created]);
      return created;
    } catch (err) {
      console.error("Create person failed:", err);
      alert(t("Couldn't add this person. Please try again."));
      return null;
    }
  }

  // "Albums, Map and People" / "앨범, 지도, 인물"
  function joinPlaces(keys: string[]): string {
    const names = keys.map((k) => t(k)).join(", ");
    return lang === "ko" ? names : names.replace(/, ([^,]*)$/, " and $1");
  }

  return (
    <main className="min-h-screen px-4 sm:px-6 pt-16 xl:pt-8 pb-24 lg:pb-10">
      <div className="max-w-5xl mx-auto">

        <HomeHero name={userName} hour={hour} stats={dashStats} photos={recentPhotos} />

        {/* ── Batch Upload UI ── */}
        {batchActive && (
          <BatchUploadPanel items={batchItems} phase={batchPhase} people={people} onCreatePerson={createPersonByName}
            onItemsChange={setBatchItems} onSave={saveBatch} onClose={resetBatch} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Upload Section ── */}
          <section className="tv-card overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-gradient-to-br from-sky-400 to-blue-500 rounded-xl flex items-center justify-center shadow-md shadow-sky-200">
                  <FileImage size={16} className="text-white" />
                </div>
                <div><h2 className="text-lg font-bold text-slate-800 leading-tight">{t("Add photos")}</h2><p className="text-xs text-slate-400">{t("One or many at once — place, date and faces are read for you")}</p></div>
              </div>
            </div>

            <div className="p-5 space-y-4">

              {!faceAnalysisOn && (
                <Link href="/profile#face-analysis"
                  className="flex items-center gap-2 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 hover:bg-slate-100 transition-colors">
                  <ScanFace size={14} className="text-slate-400 flex-shrink-0" />
                  {t("Face analysis is off — photos are saved without detecting faces.")}
                  <span className="ml-auto text-blue-600 font-bold whitespace-nowrap">{t("Settings")}</span>
                </Link>
              )}

              {/* Polaroid-style drop zone wrapper */}
              <div className="relative bg-gradient-to-br from-sky-50 to-blue-50 rounded-2xl pt-7 px-3 pb-3">
                {/* Tape strips */}
                <div className="absolute -top-2 left-8 w-14 h-5 bg-sky-300/50 rounded rotate-[-4deg] border border-sky-200/40" />
                <div className="absolute -top-1.5 left-[72px] w-10 h-4 bg-sky-200/60 rounded rotate-[3deg]" />

                {/* Inner drop zone */}
                <label className="relative flex flex-col items-center justify-center border-2 border-dashed border-sky-200 rounded-xl py-10 px-6 cursor-pointer bg-white/60 hover:bg-white/80 hover:border-sky-400 transition-all duration-200 group overflow-hidden">
                  <input type="file" accept="image/*" multiple onChange={handleFileChange} disabled={loading} className="hidden" />

                  {/* Sparkles inside box, around the icon */}
                  <span className="absolute left-[28%] top-[35%] text-sky-400 opacity-70 text-sm select-none pointer-events-none">✦</span>
                  <span className="absolute right-[26%] top-[38%] text-sky-300 opacity-60 text-xs select-none pointer-events-none">✦</span>

                  {/* Cloud upload icon */}
                  <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-md shadow-sky-100 group-hover:shadow-sky-200 border border-sky-100 group-hover:border-sky-200 transition-all duration-200">
                    <Upload size={28} className="text-sky-500 group-hover:text-sky-600 transition-colors" />
                  </div>

                  <p className="font-bold text-slate-700 group-hover:text-sky-700 transition-colors text-base">{t("Drag & drop or click to upload")}</p>
                  <p className="text-xs text-slate-400 mt-1.5">{t("JPG, PNG, HEIC, etc.")}</p>

                  {!isModelLoaded && (
                    <p className="mt-3 text-xs text-slate-400 flex items-center gap-1">
                      <Loader2 size={12} className="animate-spin" /> {t("Loading AI engine...")}
                    </p>
                  )}

                  <p className="absolute bottom-3 text-[11px] text-sky-300/80 italic tracking-wide select-none font-medium">
                    {t("Upload your photo ♡")}
                  </p>
                </label>
              </div>

              {uploadError && (
                <div role="alert" className="flex items-start gap-2 text-sm font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                  <X size={16} className="flex-shrink-0 mt-0.5" />
                  <span className="flex-1">{uploadError}</span>
                  <button onClick={() => setUploadError("")} className="text-red-400 hover:text-red-600 text-xs">{t("Dismiss")}</button>
                </div>
              )}

              {/* Analyzing indicator */}
              {loading && (
                <div className="flex items-center justify-center gap-2 text-sky-600 py-2 text-sm font-medium">
                  <Loader2 size={16} className="animate-spin" />
                  {t("Analyzing...")}
                </div>
              )}


              {/* No EXIF date — pick the day it was taken */}
              {photoInfo && !photoInfo.captureTimestamp && (
                <div className={`rounded-xl p-4 space-y-2 border ${manualDate ? "bg-sky-50 border-sky-200" : "bg-amber-50 border-amber-200"}`}>
                  <p className={`text-sm font-bold flex items-center gap-2 ${manualDate ? "text-sky-700" : "text-amber-700"}`}>
                    <CalendarDays size={15} /> {t("No date in this photo — when was it taken?")}
                  </p>
                  <div className="flex gap-2">
                    <input type="date" value={manualDate} max={toDateInputValue(new Date())}
                      disabled={isMapSaved}
                      onChange={(e) => setManualDate(e.target.value)}
                      className="flex-1 min-w-0 border border-slate-200 bg-white rounded-xl px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
                    <button type="button" disabled={isMapSaved}
                      onClick={() => { const d = new Date(); d.setDate(d.getDate() - 1); setManualDate(toDateInputValue(d)); }}
                      className="px-3 rounded-xl text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 whitespace-nowrap">
                      {t("Yesterday")}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {manualDate ? t("Saved with this date, so it lands on the right day in Albums and Trips.") : t("If you skip this, today's upload date is used.")}
                  </p>
                </div>
              )}

              {/* GPS missing — manual location input */}
              {photoInfo && photoInfo.lat === null && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-bold text-orange-700 flex items-center gap-2">
                    <MapPin size={15} /> {t("No GPS data — please enter a location manually")}
                  </p>
                  <button
                    onClick={handleCurrentLocation}
                    disabled={locationStatus === "searching"}
                    className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-300 text-white text-sm font-bold py-2.5 rounded-xl transition-colors"
                  >
                    {locationStatus === "searching"
                      ? <><Loader2 size={14} className="animate-spin" /> {t("Getting location...")}</>
                      : <><Navigation size={14} /> {t("Use Current Location (GPS)")}</>
                    }
                  </button>
                  <div className="flex gap-2">
                    <input
                      value={locationQuery}
                      onChange={(e) => setLocationQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleLocationSearch()}
                      placeholder={t("Search location (e.g., Eiffel Tower, Paris)")}
                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition-all"
                    />
                    <button
                      onClick={handleLocationSearch}
                      disabled={locationStatus === "searching"}
                      className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-slate-700 transition-colors"
                    >
                      <Search size={15} />
                    </button>
                  </div>
                  {locationStatus === "done" && manualCoords && (
                    <p className="text-xs text-emerald-600 font-semibold flex items-start gap-1">
                      <CheckCircle2 size={13} className="flex-shrink-0 mt-px" />
                      <span>
                        {t("Location set:")} {manualCoords.name.length > 60 ? `${manualCoords.name.slice(0, 60)}...` : manualCoords.name}
                        {locationNote && <span className="block font-medium text-slate-500">≈ {locationNote}. {t("Search above if it's wrong.")}</span>}
                      </span>
                    </p>
                  )}
                  {locationStatus === "error" && (
                    <p className="text-xs text-red-500 font-medium">{t("Location not found. Try a different search term.")}</p>
                  )}
                </div>
              )}

              {/* File chip + save button */}
              {photoInfo && (
                <div className="space-y-3">
                  {/* The name is editable through the Rename button — a tappable plain name went unnoticed. */}
                  <div>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5 px-1">{t("Photo name")}</p>
                    {isEditingName ? (
                      <div className="flex gap-2">
                        <div className="relative flex-1 min-w-0">
                          <Pencil size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-sky-500 pointer-events-none" />
                          <input
                            autoFocus
                            value={draftFileName}
                            onChange={(e) => setDraftFileName(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEditedName();
                              if (e.key === "Escape") setIsEditingName(false);
                            }}
                            placeholder={t("Give this photo a name")}
                            className="w-full border-2 border-sky-300 bg-white rounded-xl pl-9 pr-3 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                          />
                        </div>
                        <button onClick={saveEditedName} title={t("Save name")}
                          className="bg-sky-500 text-white px-3 rounded-xl hover:bg-sky-600 transition-colors">
                          <Check size={16} />
                        </button>
                        <button onClick={() => setIsEditingName(false)} title={t("Cancel")}
                          className="bg-slate-100 text-slate-600 px-3 rounded-xl hover:bg-slate-200 transition-colors">
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 bg-slate-50 rounded-xl pl-4 pr-2 py-3 border border-slate-100">
                        <div className="w-9 h-9 bg-sky-50 border border-sky-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <FileImage size={15} className="text-sky-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">{customFileName}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{photoInfo.fileSize}</p>
                        </div>
                        <button type="button" onClick={startEditName}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-sky-700 bg-sky-100 hover:bg-sky-200 transition-colors flex-shrink-0">
                          <Pencil size={12} /> {t("Rename")}
                        </button>
                        <button
                          onClick={clearSelection} title={t("Remove this photo")}
                          className="text-slate-400 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50 flex-shrink-0">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleSave}
                    disabled={isMapSaved || saving}
                    className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm transition-all ${
                      isMapSaved
                        ? "bg-emerald-100 text-emerald-700 cursor-not-allowed"
                        : "bg-gradient-to-r from-sky-400 to-blue-500 hover:from-sky-500 hover:to-blue-600 text-white shadow-lg shadow-sky-200 disabled:opacity-70"
                    }`}>
                    {isMapSaved ? <><CheckCircle2 size={16} /> {t("Saved")}</>
                      : saving ? <><Loader2 size={16} className="animate-spin" /> {t("Saving...")}</>
                      : <><Save size={16} /> {t("Save")}<span className="ml-1 opacity-70 text-base leading-none">✦✦</span></>}
                  </button>
                  {!isMapSaved && (
                    <p className="text-[11px] text-slate-400 text-center -mt-1">
                      {t("Adds it to {places}", { places: joinPlaces([msg("Albums"), ...((photoInfo.lat !== null || manualCoords) ? [msg("Map")] : []), ...(selectedFaceIndices.size > 0 ? [msg("People")] : [])]) })}
                      {selectedFaceIndices.size > 0 && ` (${tn(selectedFaceIndices.size, "{n} face", "{n} faces")})`}
                    </p>
                  )}

                  {savedMessage && (
                    <div className="flex items-center justify-center gap-2 text-emerald-600 text-sm font-semibold">
                      <CheckCircle2 size={16} /> {savedMessage}
                    </div>
                  )}
                </div>
              )}

            </div>
          </section>

          {/* ── Analysis Result Section (the latest trip until a photo is picked) ── */}
          {!photoInfo && !loading && latestTrip ? (
            <LatestTripCard trip={latestTrip.trip} memory={latestTrip.memory} />
          ) : (
          <section className="tv-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-sky-500 font-bold text-lg leading-none">✦</span>
                <h2 className="text-lg font-bold text-slate-800">{t("Analysis Result")}</h2>
              </div>
            </div>

            <div className="p-5">
              {photoInfo && previewUrl ? (
                <div className="space-y-3">
                  <div className="relative w-full rounded-xl overflow-hidden border border-slate-100 bg-slate-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt={customFileName}
                      className="w-full h-auto block"
                    />
                    {photoInfo.faceBoxes.map((b, i) => {
                      const selectable = !isMapSaved;
                      const selected = selectedFaceIndices.has(i);
                      return (
                        <div
                          key={i}
                          onClick={selectable ? () => toggleFaceSelection(i) : undefined}
                          className={`absolute rounded-sm border-2 transition-colors ${
                            selectable
                              ? `cursor-pointer ${selected ? "border-emerald-400 bg-emerald-400/10" : "border-sky-400 hover:border-sky-500"}`
                              : "border-sky-400 pointer-events-none"
                          }`}
                          style={{
                            left: `${b.x * 100}%`,
                            top: `${b.y * 100}%`,
                            width: `${b.width * 100}%`,
                            height: `${b.height * 100}%`,
                          }}
                        >
                          {selectable && (
                            <span className={`absolute -top-2.5 -left-2.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                              selected ? "bg-emerald-500" : "bg-sky-500"
                            }`}>
                              {i + 1}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* AI Classification gradient card */}
                  <div className={`flex items-center justify-between rounded-xl px-4 py-4 ${
                    photoInfo.faceCount > 0
                      ? "bg-gradient-to-r from-sky-400 to-blue-500"
                      : "bg-gradient-to-r from-slate-400 to-slate-500"
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0 border border-white/30">
                        <span className="text-white text-xs font-extrabold italic">Ai</span>
                      </div>
                      <div>
                        <p className="text-xs text-white/70 mb-0.5">{t("AI Classification")}</p>
                        <p className="font-extrabold text-lg text-white leading-tight">{t(photoInfo.category)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-extrabold text-white">{photoInfo.faceCount}</p>
                      <p className="text-xs text-white/70">{t("detected")}</p>
                    </div>
                  </div>

                  {photoInfo.faceBoxes.length > 0 && (
                    <div className={`rounded-xl border border-sky-100 bg-sky-50 p-3 space-y-3 ${isMapSaved ? "opacity-70 pointer-events-none" : ""}`}>
                      <p className="text-xs font-semibold text-slate-700">
                        {t("Who's in this photo? ({picked}/{total} will be saved to People)", { picked: selectedFaceIndices.size, total: photoInfo.faceBoxes.length })}
                      </p>

                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {photoInfo.faceBoxes.map((_, i) => {
                          const selected = selectedFaceIndices.has(i);
                          return (
                            <div key={i} className="flex flex-shrink-0 flex-col items-center gap-1">
                              <button
                                type="button"
                                onClick={() => toggleFaceSelection(i)}
                                className="flex flex-col items-center gap-1"
                              >
                                <div className={`relative h-16 w-16 overflow-hidden rounded-full border-2 ${
                                  selected ? "border-emerald-500 ring-2 ring-emerald-200" : "border-slate-200"
                                }`}>
                                  {faceThumbnails[i] ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={faceThumbnails[i]} alt={t("Person {n}", { n: i + 1 })} className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="h-full w-full animate-pulse bg-slate-200" />
                                  )}
                                  {selected && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/30">
                                      <Check size={20} className="text-white drop-shadow" />
                                    </div>
                                  )}
                                </div>
                                <span className={`text-[11px] font-semibold ${selected ? "text-emerald-600" : "text-slate-500"}`}>
                                  {t("Person {n}", { n: i + 1 })}
                                </span>
                              </button>
                              {/* Optionally tag this face as an existing Faces-page person instead
                                  of leaving it to automatic clustering — see faceAssignments. */}
                              {selected && (
                                <select
                                  value={faceAssignments[i] ?? ""}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={async (e) => {
                                    let val = e.target.value;
                                    if (val === NEW_PERSON) {
                                      const created = await createPersonByName();
                                      if (!created) return;
                                      val = created.id;
                                    }
                                    setFaceAssignments((prev) => {
                                      const next = { ...prev };
                                      if (val) next[i] = val; else delete next[i];
                                      return next;
                                    });
                                  }}
                                  className="w-16 text-[9px] font-semibold text-slate-600 border border-slate-200 rounded-md px-0.5 py-0.5 outline-none"
                                >
                                  <option value="">{t("Who?")}</option>
                                  {people.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                  ))}
                                  <option value={NEW_PERSON}>{t("+ New person")}</option>
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <p className="text-[11px] text-slate-400">{t("Tap a face to leave it out. Saved with the Save button.")}</p>
                    </div>
                  )}

                  {/* Info grid — all sky blue icons */}
                  <div className="grid grid-cols-2 gap-2">
                    <InfoRow label={t("File name")}    value={customFileName}           icon={FileImage}    />
                    <InfoRow label={t("File size")}    value={photoInfo.fileSize}       icon={Ruler}        />
                    <InfoRow label={t("Capture date")}
                      value={!photoInfo.captureTimestamp && manualDate ? `${captureFromDateInput(manualDate, localeOf(lang))?.captureDate ?? manualDate} ${t("(manual)")}` : t(photoInfo.captureDate)}
                      icon={CalendarDays} />
                    <InfoRow label={t("Capture time")} value={t(photoInfo.captureTime)} icon={Clock}        />
                    <InfoRow label={t("Location")}     value={t(photoInfo.location)}    icon={MapPin}       />
                    <InfoRow
                      label={t("Coordinates")}
                      value={
                        photoInfo.lat != null
                          ? `${photoInfo.lat.toFixed(4)}, ${photoInfo.lng?.toFixed(4)}`
                          : manualCoords
                            ? `${manualCoords.lat.toFixed(4)}, ${manualCoords.lng.toFixed(4)} ${t("(manual)")}`
                            : t("None")
                      }
                      icon={Navigation}
                    />
                  </div>

                  {/* Nearby places */}
                  {(placesLoading || placesFetched) && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 uppercase tracking-wide">
                        <MapPin size={11} /> {t("Nearby Places")}
                      </p>
                      {placesLoading && (
                        <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                          <Loader2 size={14} className="animate-spin" />
                          {t("Searching nearby places...")}
                        </div>
                      )}
                      {!placesLoading && placesFetched && nearbyPlaces.length === 0 && (
                        <p className="text-sm text-slate-400 italic py-1">{t("No registered places within 500m.")}</p>
                      )}
                      {!placesLoading && nearbyPlaces.length > 0 && (
                        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                          {nearbyPlaces.map((place, i) => {
                            const Icon = place.type === "cafe" ? Coffee : place.type === "bar" ? Wine : Utensils;
                            const typeLabel = place.type === "cafe" ? t("Cafe") : place.type === "bar" ? t("Bar") : t("Restaurant");
                            const typeColor = place.type === "cafe"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : place.type === "bar"
                                ? "bg-purple-50 text-purple-700 border-purple-200"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200";
                            return (
                              <div key={i} className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border ${typeColor}`}>
                                  <Icon size={14} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-slate-800 truncate">{place.name}</p>
                                  <p className="text-[11px] text-slate-400">
                                    {typeLabel}{place.cuisine ? ` · ${place.cuisine}` : ""}
                                  </p>
                                </div>
                                <span className="text-xs font-bold text-slate-500 flex-shrink-0">{place.distance_m}m</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                // Quiet empty state: one line + a light 4-step strip (the earlier
                // card-per-step version read as cluttered).
                <div className="h-80 flex flex-col items-center justify-center text-center px-4">
                  <div className="w-14 h-14 bg-sky-50 rounded-2xl flex items-center justify-center mb-3">
                    <Camera size={24} className="text-sky-400" />
                  </div>
                  <p className="text-sm font-semibold text-slate-600">{t("Your photo's analysis will appear here")}</p>
                  <p className="text-xs text-slate-400 mt-1">{t("Upload a photo to get started")}</p>

                  <div className="flex items-start mt-8 w-full max-w-sm">
                    {[
                      { icon: Upload,   label: msg("Upload") },
                      { icon: MapPin,   label: msg("Place") },
                      { icon: Users,    label: msg("Faces") },
                      { icon: Sparkles, label: msg("Trips") },
                    ].map(({ icon: Icon, label }, i) => (
                      <Fragment key={label}>
                        {i > 0 && <span className="flex-1 mt-[18px] mx-1 border-t border-dashed border-sky-200" />}
                        <div className="w-14 flex flex-col items-center gap-1.5">
                          <span className="w-9 h-9 rounded-full bg-white border border-sky-100 text-sky-500 flex items-center justify-center shadow-sm">
                            <Icon size={15} />
                          </span>
                          <span className="text-[11px] font-semibold text-slate-400">{t(label)}</span>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
          )}

        </div>

        <RecentMemories photos={recentPhotos} />

      </div>
    </main>
  );
}
