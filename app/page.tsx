"use client";

import { ChangeEvent, Fragment, useState, useEffect, useRef } from "react";
import * as exifr from "exifr";
import * as faceapi from "face-api.js";
import { motion } from "framer-motion";
import { loadMediaPipeDetector } from "@/lib/mediapipeDetector";
import BottomNav from "@/components/BottomNav";
import AnimatedNumber from "@/components/AnimatedNumber";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { supabase } from "@/lib/supabase";
import { MapPhoto, FacePhoto } from "@/lib/types";
import { fetchAllPhotos, upsertPhoto, renamePhoto, uploadToUserPhotos, migrateInlineImages } from "@/lib/photosApi";
import { fetchPeople, Person } from "@/lib/peopleApi";
import {
  Camera, Upload, MapPin, Users, CalendarDays, Clock,
  FileImage, Ruler, CheckCircle2, Loader2,
  Search, Navigation, X, Check,
  Coffee, Utensils, Wine, Sparkles, Trash2, Map,
} from "lucide-react";
import AppLogo from "@/components/AppLogo";
import BatchUploadPanel, { BatchFile } from "@/components/BatchUploadPanel";
import { BACKEND_URL } from "@/lib/backend";
import { newId } from "@/lib/id";
import { runFaceDetection, DetectionResult } from "@/lib/faceDetection";
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


const EXPRESSION_EN: Record<string, string> = {
  happy: "😊 Happy", sad: "😢 Sad", angry: "😠 Angry",
  surprised: "😮 Surprised", fearful: "😨 Fearful", disgusted: "🤢 Disgusted", neutral: "😐 Neutral",
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

// ── Main Component ──────────────────────────────
export default function HomePage() {
  const uploadRequestIdRef = useRef(0);
  // Mirrors customFileName synchronously — saveFacesToAlbum reads this instead of
  // the raw File.name so its DB write always carries whatever name is showing at
  // the moment it actually executes, even if the user renamed while face
  // detection (which can take a couple of seconds) was still running. React state
  // alone can't do this: saveFacesToAlbum's closure would only see the value of
  // customFileName from when it was called, not any rename typed afterward.
  const customFileNameRef = useRef("");
  // Similarly a ref, not state — saveFacesToAlbum and handleSaveToMap both need to
  // reserve/read this id SYNCHRONOUSLY (before their own await), so that whichever
  // of the two runs second reuses the same row instead of racing to mint its own
  // id while the other's state update hasn't committed yet (a real race with
  // useState: two handlers that both start before either's setState has been
  // applied would both see the old value and each create a separate row).
  const lastFacePhotoIdRef = useRef<string | null>(null);
  const [selectedFile,   setSelectedFile]   = useState<File | null>(null);
  const [previewUrl,     setPreviewUrl]     = useState("");
  const [photoInfo,      setPhotoInfo]      = useState<PhotoInfo | null>(null);
  const [loading,        setLoading]        = useState(false);
  const [savedMessage,   setSavedMessage]   = useState("");
  const [faceMessage,    setFaceMessage]    = useState("");
  const [customFileName, setCustomFileName] = useState("");
  const [draftFileName,  setDraftFileName]  = useState("");
  const [isEditingName,  setIsEditingName]  = useState(false);
  const [isModelLoaded,  setIsModelLoaded]  = useState(false);
  const [hasExtraModels, setHasExtraModels] = useState(false);
  const [modelType,      setModelType]      = useState<"mediapipe" | "ssd" | "tiny">("tiny");
  const [backendStatus,  setBackendStatus]  = useState<"checking" | "online" | "offline">("checking");
  const [locationQuery,  setLocationQuery]  = useState("");
  const [manualCoords,   setManualCoords]   = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "searching" | "done" | "error">("idle");
  const [nearbyPlaces,     setNearbyPlaces]     = useState<NearbyPlace[]>([]);
  const [placesLoading,    setPlacesLoading]    = useState(false);
  const [placesFetched,    setPlacesFetched]    = useState(false);
  const [dashStats,        setDashStats]        = useState({ totalPhotos: 0, totalLocations: 0, totalFaces: 0 });
  const [highlights,       setHighlights]       = useState<{ recent: MapPhoto | null; mostFaces: MapPhoto | null }>({ recent: null, mostFaces: null });
  const [batchItems,       setBatchItems]       = useState<BatchFile[]>([]);
  const [batchActive,      setBatchActive]      = useState(false);
  const [isMapSaved,       setIsMapSaved]       = useState(false);
  const [rawFaces,           setRawFaces]           = useState<{
    boxes: DetectionResult["boxes"]; descriptors: number[][]; confidences: number[];
    ages: number[]; genders: string[]; expressions: string[];
  } | null>(null);
  const [selectedFaceIndices, setSelectedFaceIndices] = useState<Set<number>>(new Set());
  const [faceSaveStatus,      setFaceSaveStatus]      = useState<"idle" | "needsSelection" | "saving" | "saved" | "failed">("idle");
  const [savedFaceCount,      setSavedFaceCount]      = useState(0);
  const [faceThumbnails,      setFaceThumbnails]      = useState<string[]>([]);
  const [people,              setPeople]              = useState<Person[]>([]);
  const [faceAssignments,     setFaceAssignments]     = useState<Record<number, string>>({});

  async function refreshStats() {
    const { data: { user } } = await supabase.auth.getUser();
    const uid = user?.id ?? "guest";
    // One round trip for both lists (was two full-table fetches).
    const { mapPhotos, facePhotos }: { mapPhotos: MapPhoto[]; facePhotos: FacePhoto[] } =
      uid === "guest" ? { mapPhotos: [], facePhotos: [] } : await fetchAllPhotos(uid);
    const locationSet = new Set(
      mapPhotos.map((p) => p.location?.split(",")[0]?.trim()).filter(Boolean)
    );
    const totalFaces = facePhotos.reduce((sum, p) => sum + (p.faceCount ?? 0), 0);
    setDashStats({ totalPhotos: mapPhotos.length, totalLocations: locationSet.size, totalFaces });
    setHighlights({
      recent: mapPhotos[0] ?? null,
      mostFaces: mapPhotos.reduce<MapPhoto | null>(
        (best, p) => ((p.faceCount ?? 0) > (best?.faceCount ?? 0) ? p : best), null
      ),
    });
  }

  useEffect(() => {
    refreshStats();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id ?? "guest";
      if (uid === "guest") return;
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

    const category = detectedFaceCount > 0 ? "Portrait" : "Scenery";
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
    setSavedFaceCount(0);

    if (detectedFaceCount === 0) {
      setFaceSaveStatus("idle");
      setSelectedFaceIndices(new Set());
    } else if (detectedFaceCount === 1) {
      // Nothing to choose between — save the one face straight away, as before.
      setSelectedFaceIndices(new Set([0]));
      await saveFacesToAlbum(file, [0], faces, lat, lng, location);
    } else {
      // Multiple people in frame — let the user pick who goes into the Faces album
      // instead of saving every detected face.
      setSelectedFaceIndices(new Set());
      setFaceThumbnails([]);
      setFaceSaveStatus("needsSelection");
      setFaceMessage(`${detectedFaceCount} faces detected — pick who to save.`);
      cropFaceThumbnails(file, faceBoxes).then(setFaceThumbnails).catch(() => setFaceThumbnails([]));
    }
  }

  // Saves only the selected face indices (boxes/descriptors/confidences stay index-aligned
  // with detection output in both browser and backend paths). Age/gender/expression are only
  // included when every detected face was selected, since backend results can drop null
  // entries from those arrays and they'd no longer line up with a partial selection.
  async function saveFacesToAlbum(
    file: File,
    indices: number[],
    faces: { boxes: DetectionResult["boxes"]; descriptors: number[][]; confidences: number[]; ages: number[]; genders: string[]; expressions: string[] },
    lat: number | null,
    lng: number | null,
    location: string,
  ) {
    const boxes       = indices.map((i) => faces.boxes[i]);
    const descriptors = indices.map((i) => faces.descriptors[i]).filter((d): d is number[] => !!d);
    const confidences = indices.map((i) => faces.confidences[i]).filter((c): c is number => c !== undefined);
    // Index-aligned with `boxes` above (built from the same `indices`), so a face
    // the user tagged with an existing person at upload time keeps that tag —
    // see the "Who is this?" picker in the needsSelection UI below.
    const personIds   = indices.map((i) => faceAssignments[i] ?? null);
    const allSelected = indices.length === faces.boxes.length;

    setFaceSaveStatus("saving");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id ?? "guest";
      if (uid === "guest") throw new Error("Not signed in");
      const dataUrl = await createThumbnailDataUrl(file, 1024, 0.90);
      // Reuse the id of a row this file was already saved under (e.g. Save to Map
      // clicked first) so this stays one row with both flags, not two rows. Reserved
      // synchronously, before the upsert below, so a concurrent Save to Map click
      // (or a rename) during this write's network round-trip sees the same id
      // instead of racing to mint its own.
      const photoId = lastFacePhotoIdRef.current ?? newId();
      lastFacePhotoIdRef.current = photoId;
      const imageUrl = await uploadToUserPhotos(uid, photoId, dataUrl);
      await upsertPhoto(uid, {
        id: photoId,
        // The live current name, not the File object's original name — so a
        // rename typed while detection was still running (customFileNameRef
        // updates synchronously; this whole function's own closure over `file`
        // wouldn't see it otherwise) actually lands on the row.
        fileName: customFileNameRef.current || file.name,
        imageUrl,
        faceCount: boxes.length,
        isFacePhoto: true,
        ...(boxes.length > 0       && { boxes }),
        ...(descriptors.length > 0 && { descriptors }),
        ...(confidences.length > 0 && { confidences }),
        ...(personIds.some((p) => p !== null) && { personIds }),
        ...(allSelected && faces.ages.length > 0        && { ages: faces.ages }),
        ...(allSelected && faces.genders.length > 0     && { genders: faces.genders }),
        ...(allSelected && faces.expressions.length > 0 && { expressions: faces.expressions }),
        ...(lat !== null               && { lat }),
        ...(lng !== null               && { lng }),
        ...(location !== "No GPS data" && { location }),
      });
      setSavedFaceCount(boxes.length);
      setFaceSaveStatus("saved");
      const topExpr = allSelected && faces.expressions[0] ? (EXPRESSION_EN[faces.expressions[0]] ?? faces.expressions[0]) : null;
      setFaceMessage(`${boxes.length} face(s) saved to Faces album.${topExpr ? ` · ${topExpr}` : ""}`);
      refreshStats();
    } catch (saveErr) {
      console.error("Face photo save failed:", saveErr);
      setFaceSaveStatus("failed");
      setFaceMessage("Couldn't save the selected face(s). Please try again.");
    }
  }

  function toggleFaceSelection(index: number) {
    setSelectedFaceIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  async function handleSaveSelectedFaces() {
    if (!selectedFile || !rawFaces || !photoInfo || selectedFaceIndices.size === 0) return;
    await saveFacesToAlbum(
      selectedFile,
      Array.from(selectedFaceIndices).sort((a, b) => a - b),
      rawFaces,
      photoInfo.lat,
      photoInfo.lng,
      photoInfo.location,
    );
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    if (files.length > 1) { processBatch(files); return; }
    const file = files[0];
    const requestId = ++uploadRequestIdRef.current;

    setSavedMessage("");
    setFaceMessage("");
    setManualCoords(null);
    setLocationQuery("");
    setLocationStatus("idle");
    lastFacePhotoIdRef.current = null;
    setNearbyPlaces([]);
    setPlacesFetched(false);
    setIsMapSaved(false);
    setRawFaces(null);
    setSelectedFaceIndices(new Set());
    setFaceSaveStatus("idle");
    setSavedFaceCount(0);
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
        const data = await analyzeWithBackend(file);
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
        // Temporary diagnostics for tuning the backend's det_thresh — if a face
        // gets wrongly detected (or a real one missed), check this in devtools
        // to see the confidence score and normalized box InsightFace actually
        // returned for it, rather than guessing at the threshold blind.
        console.log(`[API mode] ${detectedFaceCount} face(s) detected`, faceBoxes.map((b, i) => ({
          confidence: faceConfidences[i], x: b.x.toFixed(3), y: b.y.toFixed(3), w: b.width.toFixed(3), h: b.height.toFixed(3),
        })));
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const exifData: any = await exifr.parse(file).catch(() => null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gpsData:  any = await exifr.gps(file).catch(() => null);
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
        if (isModelLoaded) {
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
    if (!navigator.geolocation) { alert("Geolocation is not supported by your browser."); return; }
    setLocationStatus("searching");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const name = await reverseGeocode(lat, lng);
        setManualCoords({ lat, lng, name: name || `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
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
      () => { alert("Unable to retrieve your location."); setLocationStatus("error"); }
    );
  }

  async function processBatch(files: File[]) {
    setBatchActive(true);
    const items: BatchFile[] = files.map((f) => ({ name: f.name, status: "pending", info: "" }));
    setBatchItems([...items]);

    const { data: { user } } = await supabase.auth.getUser();
    const uid = user?.id ?? "guest";

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      items[i] = { ...items[i], status: "processing" };
      setBatchItems([...items]);
      try {
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
        let faceAgesB:    number[] = [];
        let faceGendersB: string[] = [];
        let faceExprsB:   string[] = [];

        // Same backend/browser split as the single-photo upload path (handleFileChange)
        // — batch upload used to always run browser-mode face detection even with the
        // backend online, silently giving batch uploads worse accuracy than single ones.
        if (backendStatus === "online") {
          const data = await analyzeWithBackend(file);
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
          faceAgesB       = (data.ages ?? []).filter((a): a is number => a !== null);
          faceGendersB    = (data.genders ?? []).filter((g): g is string => g !== null);
          console.log(`[API mode][batch] ${file.name}: ${faceCount} face(s) detected`, faceBoxes.map((b, j) => ({
            confidence: faceConfs[j], x: b.x.toFixed(3), y: b.y.toFixed(3), w: b.width.toFixed(3), h: b.height.toFixed(3),
          })));
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const exifData: any = await exifr.parse(file).catch(() => null);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const gpsData:  any = await exifr.gps(file).catch(() => null);
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
          if (isModelLoaded) {
            const imgEl = await faceapi.fetchImage(URL.createObjectURL(file));
            const r = await runFaceDetection(imgEl, modelType, hasExtraModels);
            faceCount       = r.count;
            faceBoxes       = r.boxes;
            faceDescriptors = r.descriptors;
            faceConfs       = r.confidences;
            faceAgesB       = r.ages;
            faceGendersB    = r.genders;
            faceExprsB      = r.expressions;
          }
        }
        const dataUrl = await createThumbnailDataUrl(file, 1024, 0.90);
        const photoId = newId();

        // A failed upload throws into this file's catch below (marked as an error
        // in the batch panel) rather than saving the image inline in the DB row.
        const imageUrl = uid !== "guest" ? await uploadToUserPhotos(uid, photoId, dataUrl) : dataUrl;

        if (uid !== "guest") {
          await upsertPhoto(uid, {
            id: photoId,
            fileName: file.name,
            imageUrl,
            lat, lng, location,
            captureDate, captureTime, captureTimestamp,
            faceCount,
            isMapPhoto: true,
            isFacePhoto: faceCount > 0,
            ...(faceBoxes.length > 0       && { boxes: faceBoxes }),
            ...(faceDescriptors.length > 0 && { descriptors: faceDescriptors }),
            ...(faceConfs.length > 0       && { confidences: faceConfs }),
            ...(faceAgesB.length > 0       && { ages: faceAgesB }),
            ...(faceGendersB.length > 0    && { genders: faceGendersB }),
            ...(faceExprsB.length > 0      && { expressions: faceExprsB }),
          });
        }
        const infoParts: string[] = [];
        if (faceCount > 0) infoParts.push(`${faceCount} face(s)`);
        infoParts.push(location ? location.split(",")[0] : "No GPS");
        items[i] = {
          ...items[i],
          status: "done",
          info: infoParts.join(" · "),
          photoId,
          imageUrl,
          faceCount,
          fileSize: formatBytes(file.size),
          location,
          captureDate,
          captureTime,
          lat,
          lng,
          editName: file.name,
        };
      } catch (err) {
        console.error(`Batch error [${file.name}]:`, err);
        items[i] = { ...items[i], status: "error", info: "Failed" };
      }
      setBatchItems([...items]);
    }
    refreshStats();
  }

  function resetBatch() {
    setBatchActive(false);
    setBatchItems([]);
  }

  async function handleBatchRename(photoId: string, newName: string) {
    if (!newName.trim() || !photoId) return;
    const { data: { user } } = await supabase.auth.getUser();
    const uid = user?.id ?? "guest";
    if (uid === "guest") return;
    await renamePhoto(uid, photoId, newName.trim());
  }

  function clearSelection() {
    setSelectedFile(null);
    setPreviewUrl("");
    setPhotoInfo(null);
    setCustomFileName("");
    customFileNameRef.current = "";
    setDraftFileName("");
    setSavedMessage("");
    setFaceMessage("");
    setManualCoords(null);
    setLocationStatus("idle");
    lastFacePhotoIdRef.current = null;
    setNearbyPlaces([]);
    setPlacesFetched(false);
    setIsMapSaved(false);
    setRawFaces(null);
    setSelectedFaceIndices(new Set());
    setFaceSaveStatus("idle");
    setSavedFaceCount(0);
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
        const { data: { user } } = await supabase.auth.getUser();
        const uid = user?.id ?? "guest";
        if (uid !== "guest") await renamePhoto(uid, lastFacePhotoIdRef.current, newName);
      }
    }
    setIsEditingName(false);
  }

  async function handleSaveToMap() {
    if (!selectedFile || !photoInfo) return;
    const effectiveLat = photoInfo.lat ?? manualCoords?.lat ?? null;
    const effectiveLng = photoInfo.lng ?? manualCoords?.lng ?? null;
    if (effectiveLat === null || effectiveLng === null) {
      alert("No location data. Please search for a place or use your current location below.");
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id ?? "guest";
      if (uid === "guest") throw new Error("Not signed in");

      // Reuse the id of the face-detection row this file already got saved under
      // (if any), so this becomes one row with both is_map_photo and is_face_photo
      // set, instead of two rows for the same photo. Reserved synchronously (see
      // the matching comment in saveFacesToAlbum) so a concurrent face-save
      // in flight for the same file can't race this into minting a second id.
      const photoId = lastFacePhotoIdRef.current ?? newId();
      lastFacePhotoIdRef.current = photoId;
      const dataUrl = await createThumbnailDataUrl(selectedFile, 1024, 0.90);

      const imageUrl = await uploadToUserPhotos(uid, photoId, dataUrl);

      await upsertPhoto(uid, {
        id: photoId,
        fileName: customFileName.trim() || selectedFile.name,
        imageUrl,
        lat: effectiveLat,
        lng: effectiveLng,
        location: manualCoords?.name ?? photoInfo.location,
        captureDate: photoInfo.captureDate !== "Not available" ? photoInfo.captureDate : null,
        captureTime: photoInfo.captureTime !== "Not available" ? photoInfo.captureTime : null,
        captureTimestamp: photoInfo.captureTimestamp,
        faceCount: savedFaceCount,
        isMapPhoto: true,
      });

      setIsMapSaved(true);
      setSavedMessage("Saved to map and albums!");
      refreshStats();
    } catch (err) {
      console.error("Save to map failed:", err);
      setSavedMessage(`Save failed: ${err instanceof Error ? err.message : "Please try again."}`);
    }
  }

  return (
    <main className="min-h-screen px-4 sm:px-6 pt-16 xl:pt-8 pb-28">
      <div className="max-w-5xl mx-auto">

        {/* Header — soft pastel hero banner */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100 via-sky-50 to-blue-100 border border-sky-200/60 px-5 pt-5 pb-6 sm:px-6 sm:pt-6 sm:pb-7 mb-6 shadow-sm"
        >
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-sky-200/50 rounded-full blur-2xl" />
          <div className="absolute -bottom-16 -left-8 w-44 h-44 bg-blue-200/40 rounded-full blur-2xl" />

          <div className="relative flex items-center gap-3 mb-1">
            <motion.div whileHover={{ rotate: -8, scale: 1.05 }} transition={{ type: "spring", stiffness: 300, damping: 15 }}>
              <AppLogo size="md" className="shadow-md shadow-blue-200" />
            </motion.div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-800">
              Travel<span className="bg-gradient-to-r from-sky-500 to-blue-500 bg-clip-text text-transparent">ries</span>
            </h1>
          </div>
          <p className="relative text-slate-500 ml-[52px] text-sm mb-5">Upload travel photos to automatically analyze location &amp; faces.</p>

          {/* ── Dashboard Stats ── */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="relative grid grid-cols-3 gap-3"
          >
            {[
              { label: "Photos Saved",   short: "Photos", value: dashStats.totalPhotos,    icon: Camera, gradient: "from-sky-400 to-blue-500" },
              { label: "Places Visited", short: "Places", value: dashStats.totalLocations, icon: MapPin, gradient: "from-emerald-400 to-teal-500" },
              { label: "Faces Detected", short: "Faces",  value: dashStats.totalFaces,     icon: Users,  gradient: "from-amber-400 to-orange-500" },
            ].map(({ label, short, value, icon: Icon, gradient }) => (
              <motion.div
                key={label}
                variants={fadeUp}
                whileHover={{ y: -3, scale: 1.02, boxShadow: "0 10px 25px -5px rgba(0,0,0,0.08)" }}
                className="bg-white/80 backdrop-blur rounded-2xl border border-white shadow-sm px-3 py-3 sm:px-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3"
              >
                <div className={`w-9 h-9 bg-gradient-to-br ${gradient} rounded-xl flex items-center justify-center flex-shrink-0 shadow-md`}>
                  <Icon size={17} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-extrabold text-slate-800 leading-tight">
                    <AnimatedNumber value={value} />
                  </p>
                  <p className="text-[11px] text-slate-500 font-medium truncate">
                    <span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span>
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>

        {/* ── Batch Upload UI ── */}
        {batchActive && (
          <BatchUploadPanel items={batchItems} onItemsChange={setBatchItems} onRename={handleBatchRename} onClose={resetBatch} />
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
                <h2 className="text-lg font-bold text-slate-800">Upload Photo</h2>
              </div>
            </div>

            <div className="p-5 space-y-4">

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

                  <p className="font-bold text-slate-700 group-hover:text-sky-700 transition-colors text-base">Drag & drop or click to upload</p>
                  <p className="text-xs text-slate-400 mt-1.5">JPG, PNG, HEIC, etc.</p>

                  {!isModelLoaded && (
                    <p className="mt-3 text-xs text-slate-400 flex items-center gap-1">
                      <Loader2 size={12} className="animate-spin" /> Loading AI engine...
                    </p>
                  )}

                  <p className="absolute bottom-3 text-[11px] text-sky-300/80 italic tracking-wide select-none font-medium">
                    Upload your photo ♡
                  </p>
                </label>
              </div>

              {/* Analyzing indicator */}
              {loading && (
                <div className="flex items-center justify-center gap-2 text-sky-600 py-2 text-sm font-medium">
                  <Loader2 size={16} className="animate-spin" />
                  Analyzing...
                </div>
              )}


              {/* GPS missing — manual location input */}
              {photoInfo && photoInfo.lat === null && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-bold text-orange-700 flex items-center gap-2">
                    <MapPin size={15} /> No GPS data — please enter a location manually
                  </p>
                  <button
                    onClick={handleCurrentLocation}
                    disabled={locationStatus === "searching"}
                    className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-300 text-white text-sm font-bold py-2.5 rounded-xl transition-colors"
                  >
                    {locationStatus === "searching"
                      ? <><Loader2 size={14} className="animate-spin" /> Getting location...</>
                      : <><Navigation size={14} /> Use Current Location (GPS)</>
                    }
                  </button>
                  <div className="flex gap-2">
                    <input
                      value={locationQuery}
                      onChange={(e) => setLocationQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleLocationSearch()}
                      placeholder="Search location (e.g., Eiffel Tower, Paris)"
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
                    <p className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                      <CheckCircle2 size={13} /> Location set: {manualCoords.name.slice(0, 60)}...
                    </p>
                  )}
                  {locationStatus === "error" && (
                    <p className="text-xs text-red-500 font-medium">Location not found. Try a different search term.</p>
                  )}
                </div>
              )}

              {/* File chip + save button */}
              {photoInfo && (
                <div className="space-y-3">
                  {isEditingName ? (
                    <div className="flex gap-2">
                      <input
                        value={draftFileName}
                        onChange={(e) => setDraftFileName(e.target.value)}
                        className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                      />
                      <button onClick={saveEditedName}
                        className="bg-sky-500 text-white px-3 py-2 rounded-xl hover:bg-sky-600 transition-colors">
                        <Check size={16} />
                      </button>
                      <button onClick={() => setIsEditingName(false)}
                        className="bg-slate-100 text-slate-600 px-3 py-2 rounded-xl hover:bg-slate-200 transition-colors">
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                      <div className="w-9 h-9 bg-sky-50 border border-sky-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FileImage size={15} className="text-sky-500" />
                      </div>
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={startEditName}>
                        <p className="text-sm font-bold text-slate-800 truncate">{customFileName}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{photoInfo.fileSize}</p>
                      </div>
                      <button
                        onClick={clearSelection}
                        className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded-lg hover:bg-red-50">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}

                  <button
                    onClick={handleSaveToMap}
                    disabled={isMapSaved}
                    className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm transition-all ${
                      isMapSaved
                        ? "bg-emerald-100 text-emerald-700 cursor-not-allowed"
                        : "bg-gradient-to-r from-sky-400 to-blue-500 hover:from-sky-500 hover:to-blue-600 text-white shadow-lg shadow-sky-200"
                    }`}>
                    {isMapSaved ? <><CheckCircle2 size={16} /> Already Saved</> : <><Map size={16} /> Save to Map<span className="ml-1 opacity-70 text-base leading-none">✦✦</span></>}
                  </button>

                  {savedMessage && (
                    <div className="flex items-center justify-center gap-2 text-emerald-600 text-sm font-semibold">
                      <CheckCircle2 size={16} /> {savedMessage}
                    </div>
                  )}
                </div>
              )}

            </div>
          </section>

          {/* ── Analysis Result Section ── */}
          <section className="tv-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-sky-500 font-bold text-lg leading-none">✦</span>
                <h2 className="text-lg font-bold text-slate-800">Analysis Result</h2>
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
                      const selectable = faceSaveStatus === "needsSelection";
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
                        <p className="text-xs text-white/70 mb-0.5">AI Classification</p>
                        <p className="font-extrabold text-lg text-white leading-tight">{photoInfo.category}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-extrabold text-white">{photoInfo.faceCount}</p>
                      <p className="text-xs text-white/70">detected</p>
                    </div>
                  </div>

                  {faceSaveStatus === "needsSelection" && (
                    <div className="rounded-xl border border-sky-100 bg-sky-50 p-3 space-y-3">
                      <p className="text-xs font-semibold text-slate-700">
                        Who do you want to save? ({selectedFaceIndices.size}/{photoInfo.faceBoxes.length} selected)
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
                                    <img src={faceThumbnails[i]} alt={`Person ${i + 1}`} className="h-full w-full object-cover" />
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
                                  Person {i + 1}
                                </span>
                              </button>
                              {/* Optionally tag this face as an existing Faces-page person instead
                                  of leaving it to automatic clustering — see faceAssignments. */}
                              {selected && people.length > 0 && (
                                <select
                                  value={faceAssignments[i] ?? ""}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setFaceAssignments((prev) => {
                                      const next = { ...prev };
                                      if (val) next[i] = val; else delete next[i];
                                      return next;
                                    });
                                  }}
                                  className="w-16 text-[9px] font-semibold text-slate-600 border border-slate-200 rounded-md px-0.5 py-0.5 outline-none"
                                >
                                  <option value="">Who?</option>
                                  {people.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <button
                        onClick={handleSaveSelectedFaces}
                        disabled={selectedFaceIndices.size === 0}
                        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm transition-all ${
                          selectedFaceIndices.size === 0
                            ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                            : "bg-gradient-to-r from-emerald-400 to-emerald-500 hover:from-emerald-500 hover:to-emerald-600 text-white shadow-lg shadow-emerald-100"
                        }`}>
                        <Users size={16} />
                        Save {selectedFaceIndices.size || ""} face{selectedFaceIndices.size === 1 ? "" : "s"} to Faces
                      </button>
                    </div>
                  )}

                  {faceSaveStatus === "saving" && (
                    <p className="text-xs font-medium px-1 text-slate-500">Saving selected face(s)...</p>
                  )}

                  {(faceSaveStatus === "saved" || faceSaveStatus === "failed") && faceMessage && (
                    <p className={`text-xs font-medium px-1 ${
                      faceSaveStatus === "failed" ? "text-red-500" : "text-emerald-600"
                    }`}>
                      {faceMessage}
                    </p>
                  )}

                  {/* Info grid — all sky blue icons */}
                  <div className="grid grid-cols-2 gap-2">
                    <InfoRow label="File name"    value={customFileName}        icon={FileImage}    />
                    <InfoRow label="File size"    value={photoInfo.fileSize}    icon={Ruler}        />
                    <InfoRow label="Capture date" value={photoInfo.captureDate} icon={CalendarDays} />
                    <InfoRow label="Capture time" value={photoInfo.captureTime} icon={Clock}        />
                    <InfoRow label="Location"     value={photoInfo.location}    icon={MapPin}       />
                    <InfoRow
                      label="Coordinates"
                      value={
                        photoInfo.lat != null
                          ? `${photoInfo.lat.toFixed(4)}, ${photoInfo.lng?.toFixed(4)}`
                          : manualCoords
                            ? `${manualCoords.lat.toFixed(4)}, ${manualCoords.lng.toFixed(4)} (manual)`
                            : "None"
                      }
                      icon={Navigation}
                    />
                  </div>

                  {/* Nearby places */}
                  {(placesLoading || placesFetched) && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 uppercase tracking-wide">
                        <MapPin size={11} /> Nearby Places
                      </p>
                      {placesLoading && (
                        <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                          <Loader2 size={14} className="animate-spin" />
                          Searching nearby places...
                        </div>
                      )}
                      {!placesLoading && placesFetched && nearbyPlaces.length === 0 && (
                        <p className="text-sm text-slate-400 italic py-1">No registered places within 500m.</p>
                      )}
                      {!placesLoading && nearbyPlaces.length > 0 && (
                        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                          {nearbyPlaces.map((place, i) => {
                            const Icon = place.type === "cafe" ? Coffee : place.type === "bar" ? Wine : Utensils;
                            const typeLabel = place.type === "cafe" ? "Cafe" : place.type === "bar" ? "Bar" : "Restaurant";
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
                  <p className="text-sm font-semibold text-slate-600">Your photo&apos;s analysis will appear here</p>
                  <p className="text-xs text-slate-400 mt-1">Upload a photo to get started</p>

                  <div className="flex items-start mt-8 w-full max-w-sm">
                    {[
                      { icon: Upload,   label: "Upload" },
                      { icon: MapPin,   label: "Place" },
                      { icon: Users,    label: "Faces" },
                      { icon: Sparkles, label: "Trips" },
                    ].map(({ icon: Icon, label }, i) => (
                      <Fragment key={label}>
                        {i > 0 && <span className="flex-1 mt-[18px] mx-1 border-t border-dashed border-sky-200" />}
                        <div className="w-14 flex flex-col items-center gap-1.5">
                          <span className="w-9 h-9 rounded-full bg-white border border-sky-100 text-sky-500 flex items-center justify-center shadow-sm">
                            <Icon size={15} />
                          </span>
                          <span className="text-[11px] font-semibold text-slate-400">{label}</span>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

        </div>

        {/* ── Highlights ── */}
        {(highlights.recent || (highlights.mostFaces && (highlights.mostFaces.faceCount ?? 0) > 0)) && (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.4 }}
            className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
          >
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-amber-50 to-orange-50">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0">
                <Sparkles size={13} className="text-white" />
              </div>
              <h2 className="font-bold text-slate-800">Highlights</h2>
            </div>
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              className="p-4 grid grid-cols-2 gap-3"
            >
              {highlights.recent && (
                <motion.div variants={fadeUp} whileHover={{ y: -2 }}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Clock size={9} /> Recent Upload
                  </p>
                  <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50 shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={highlights.recent.imageUrl} alt={highlights.recent.fileName} className="w-full h-36 object-cover bg-slate-100" />
                    <div className="p-2.5">
                      <p className="text-xs font-bold text-slate-800 truncate">{highlights.recent.fileName}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                        <CalendarDays size={9} />
                        {highlights.recent.captureDate ?? highlights.recent.uploadedAt?.slice(0, 10) ?? ""}
                      </p>
                      {(highlights.recent.location) && (
                        <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1 truncate">
                          <MapPin size={9} />{highlights.recent.location.split(",")[0]}
                        </p>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
              {highlights.mostFaces && (highlights.mostFaces.faceCount ?? 0) > 0 && (
                <motion.div variants={fadeUp} whileHover={{ y: -2 }}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Users size={9} /> Most Faces
                  </p>
                  <div className="rounded-xl overflow-hidden border border-sky-200 bg-slate-50 shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={highlights.mostFaces.imageUrl} alt={highlights.mostFaces.fileName} className="w-full h-36 object-cover bg-slate-100" />
                    <div className="p-2.5">
                      <p className="text-xs font-bold text-slate-800 truncate">{highlights.mostFaces.fileName}</p>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full mt-1">
                        <Users size={8} /> {highlights.mostFaces.faceCount} face(s)
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          </motion.section>
        )}

      </div>
      <BottomNav />
    </main>
  );
}
