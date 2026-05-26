"use client";

import { ChangeEvent, useState, useEffect } from "react";
import * as exifr from "exifr";
import * as faceapi from "face-api.js";
import BottomNav from "@/components/BottomNav";
import { supabase } from "@/lib/supabase";
import { MapPhoto } from "@/lib/types";
import {
  Camera, Upload, MapPin, Users, CalendarDays, Clock,
  FileImage, Ruler, CheckCircle2, Loader2, Cpu, AlertTriangle,
  Search, Navigation, Save, Pencil, X, Check, Wifi, WifiOff,
  Coffee, Utensils, Wine, Sparkles,
} from "lucide-react";
import AppLogo from "@/components/AppLogo";

// ── Types ──────────────────────────────────────
export type FacePhoto = {
  id: string;
  fileName: string;
  imageUrl: string;
  faceCount: number;
  uploadedAt: string;
  boxes?: Array<{ x: number; y: number; width: number; height: number }>;
  descriptors?: number[][];
  confidences?: number[];
  ages?: number[];
  genders?: string[];
  expressions?: string[];
  lat?: number;
  lng?: number;
  location?: string;
  image_path?: string;
};

type NearbyPlace = {
  name: string;
  type: "restaurant" | "cafe" | "bar" | string;
  cuisine: string;
  distance_m: number;
};

type BatchFile = {
  name: string;
  status: "pending" | "processing" | "done" | "error";
  info: string;
};

type PhotoInfo = {
  fileName: string;
  fileType: string;
  fileSize: string;
  uploadedAt: string;
  captureDate: string;
  captureTime: string;
  location: string;
  lat: number | null;
  lng: number | null;
  faceCount: number;
  category: string;
};

const BACKEND_URL = "http://localhost:8000";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

async function createThumbnailDataUrl(file: File, maxSize: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await res.json();
    const a = data.address || {};
    const parts = [
      a.road,
      a.neighbourhood || a.suburb || a.quarter,
      a.city_district || a.district,
      a.city || a.town || a.village || a.county,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : (data.display_name || "");
  } catch { return ""; }
}

async function forwardGeocode(query: string): Promise<{ lat: number; lng: number; name: string } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await res.json();
    if (!data[0]) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: data[0].display_name };
  } catch { return null; }
}

async function fetchNearbyPlaces(lat: number, lng: number): Promise<NearbyPlace[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/nearby-places?lat=${lat}&lng=${lng}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.places ?? [];
  } catch { return []; }
}

async function analyzeWithBackend(file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BACKEND_URL}/analyze`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  return res.json() as Promise<{
    captureDate: string | null;
    captureTime: string | null;
    latitude:    number | null;
    longitude:   number | null;
    location:    string | null;
    faceCount:   number;
    faceBoxes:   Array<{ x_norm: number; y_norm: number; w_norm: number; h_norm: number }>;
    descriptors: number[][];
    ages:        (number | null)[];
    genders:     (string | null)[];
    confidences: number[];
  }>;
}

// ── Face detection helpers ─────────────────────
type DetectionResult = {
  count:       number;
  boxes:       Array<{ x: number; y: number; width: number; height: number }>;
  descriptors: number[][];
  confidences: number[];
  ages:        number[];
  genders:     string[];
  expressions: string[];
};

const EXPRESSION_EN: Record<string, string> = {
  happy: "😊 Happy", sad: "😢 Sad", angry: "😠 Angry",
  surprised: "😮 Surprised", fearful: "😨 Fearful", disgusted: "🤢 Disgusted", neutral: "😐 Neutral",
};

function boxIoU(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  return inter / (a.width * a.height + b.width * b.height - inter);
}

async function runFaceDetection(
  imgEl: HTMLImageElement,
  modelType: "ssd" | "tiny",
  hasExtra: boolean,
): Promise<DetectionResult> {
  const MIN_PX = 20;
  const W = imgEl.naturalWidth, H = imgEl.naturalHeight;
  const normBox = (b: { x: number; y: number; width: number; height: number }) =>
    ({ x: b.x / W, y: b.y / H, width: b.width / W, height: b.height / H });

  if (modelType === "ssd") {
    const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });

    if (hasExtra) {
      const all = await faceapi
        .detectAllFaces(imgEl, opts)
        .withFaceLandmarks()
        .withFaceDescriptors()
        .withAgeAndGender()
        .withFaceExpressions();
      const f = all.filter((d) => d.detection.box.width >= MIN_PX && d.detection.box.height >= MIN_PX);
      return {
        count:       f.length,
        boxes:       f.map((d) => normBox(d.detection.box)),
        descriptors: f.map((d) => Array.from(d.descriptor)),
        confidences: f.map((d) => d.detection.score),
        ages:        f.map((d) => Math.round(d.age)),
        genders:     f.map((d) => d.gender),
        expressions: f.map((d) => {
          const e = d.expressions as unknown as Record<string, number>;
          return Object.entries(e).sort((a, b) => b[1] - a[1])[0][0];
        }),
      };
    }

    const all = await faceapi
      .detectAllFaces(imgEl, opts)
      .withFaceLandmarks()
      .withFaceDescriptors();
    const f = all.filter((d) => d.detection.box.width >= MIN_PX && d.detection.box.height >= MIN_PX);
    return {
      count:       f.length,
      boxes:       f.map((d) => normBox(d.detection.box)),
      descriptors: f.map((d) => Array.from(d.descriptor)),
      confidences: f.map((d) => d.detection.score),
      ages: [], genders: [], expressions: [],
    };
  }

  // TinyFaceDetector — multi-scale (416 + 608) with NMS for better small-face coverage
  const [d416, d608] = await Promise.all([
    faceapi.detectAllFaces(imgEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.2 })),
    faceapi.detectAllFaces(imgEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.2 })),
  ]);
  const sorted = [...d416, ...d608].sort((a, b) => b.score - a.score);
  const kept: typeof sorted = [];
  for (const d of sorted) {
    const box = { x: d.box.x, y: d.box.y, width: d.box.width, height: d.box.height };
    if (kept.every((k) => boxIoU(box, { x: k.box.x, y: k.box.y, width: k.box.width, height: k.box.height }) < 0.45)) {
      kept.push(d);
    }
  }
  const f = kept.filter((d) => d.box.width >= MIN_PX && d.box.height >= MIN_PX);
  return {
    count:       f.length,
    boxes:       f.map((d) => normBox(d.box)),
    descriptors: [],
    confidences: f.map((d) => d.score),
    ages: [], genders: [], expressions: [],
  };
}

// ── InfoRow component ──────────────────────────
function InfoRow({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ElementType }) {
  return (
    <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
      <p className="text-[11px] text-slate-400 font-medium mb-0.5 flex items-center gap-1">
        {Icon && <Icon size={11} />}
        {label}
      </p>
      <p className="text-sm font-bold text-slate-800 break-all leading-snug">{value}</p>
    </div>
  );
}

// ── Main Component ──────────────────────────────
export default function HomePage() {
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
  const [modelType,      setModelType]      = useState<"ssd" | "tiny">("tiny");
  const [backendStatus,  setBackendStatus]  = useState<"checking" | "online" | "offline">("checking");
  const [locationQuery,  setLocationQuery]  = useState("");
  const [manualCoords,   setManualCoords]   = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "searching" | "done" | "error">("idle");
  const [lastFacePhotoId,  setLastFacePhotoId]  = useState<string | null>(null);
  const [nearbyPlaces,     setNearbyPlaces]     = useState<NearbyPlace[]>([]);
  const [placesLoading,    setPlacesLoading]    = useState(false);
  const [placesFetched,    setPlacesFetched]    = useState(false);
  const [dashStats,        setDashStats]        = useState({ totalPhotos: 0, totalLocations: 0, totalFaces: 0 });
  const [highlights,       setHighlights]       = useState<{ recent: MapPhoto | null; mostFaces: MapPhoto | null }>({ recent: null, mostFaces: null });
  const [batchItems,       setBatchItems]       = useState<BatchFile[]>([]);
  const [batchActive,      setBatchActive]      = useState(false);

  async function refreshStats() {
    const { data: { user } } = await supabase.auth.getUser();
    const uid = user?.id ?? "guest";
    const mapPhotos: MapPhoto[] = JSON.parse(localStorage.getItem(`map-${uid}`) ?? "[]");
    const facePhotos: FacePhoto[] = JSON.parse(localStorage.getItem(`faces-${uid}`) ?? "[]");
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const MODEL_URL = "/models";
    Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]).then(() => {
      setModelType("ssd");
      setIsModelLoaded(true);
      // Optionally load age/gender + expression nets (requires extra weights from download-models.sh)
      Promise.all([
        faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
      ]).then(() => setHasExtraModels(true)).catch(() => {});
    }).catch(() => {
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)
        .then(() => { setModelType("tiny"); setIsModelLoaded(true); })
        .catch((err) => console.error("AI model load failed", err));
    });
  }, []);

  useEffect(() => {
    fetch(`${BACKEND_URL}/health`)
      .then((r) => setBackendStatus(r.ok ? "online" : "offline"))
      .catch(() => setBackendStatus("offline"));
  }, []);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    if (files.length > 1) { processBatch(files); return; }
    const file = files[0];

    setSavedMessage("");
    setFaceMessage("");
    setManualCoords(null);
    setLocationQuery("");
    setLocationStatus("idle");
    setLastFacePhotoId(null);
    setNearbyPlaces([]);
    setPlacesFetched(false);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setCustomFileName(file.name);
    setDraftFileName(file.name);
    setIsEditingName(false);
    setLoading(true);

    try {
      let lat: number | null = null;
      let lng: number | null = null;
      let captureDate = "Not available";
      let captureTime = "Not available";
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
        location      = data.location ?? (lat !== null ? `${lat.toFixed(6)}, ${lng?.toFixed(6)}` : "No GPS data");
        detectedFaceCount = data.faceCount ?? 0;
        faceBoxes         = (data.faceBoxes ?? []).map((b) => ({ x: b.x_norm, y: b.y_norm, width: b.w_norm, height: b.h_norm }));
        faceDescriptors   = data.descriptors ?? [];
        faceConfidences   = (data.confidences ?? []).map(Number);
        faceAges          = (data.ages ?? []).filter((a): a is number => a !== null);
        faceGenders       = (data.genders ?? []).filter((g): g is string => g !== null);
      } else {
        const exifData: any = await exifr.parse(file).catch(() => null);
        const gpsData:  any = await exifr.gps(file).catch(() => null);
        lat = typeof gpsData?.latitude  === "number" ? gpsData.latitude  : null;
        lng = typeof gpsData?.longitude === "number" ? gpsData.longitude : null;
        const takenAt = exifData?.DateTimeOriginal || exifData?.CreateDate || null;
        if (takenAt) {
          const d = new Date(takenAt);
          captureDate = d.toLocaleDateString();
          captureTime = d.toLocaleTimeString();
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

      const category = detectedFaceCount > 0 ? "Portrait" : "Scenery";
      setPhotoInfo({
        fileName: file.name, fileType: file.type || "unknown",
        fileSize: formatBytes(file.size), uploadedAt: new Date().toLocaleString(),
        captureDate, captureTime, location, lat, lng,
        faceCount: detectedFaceCount, category,
      });

      if (lat !== null && lng !== null && backendStatus === "online") {
        setPlacesLoading(true);
        fetchNearbyPlaces(lat, lng).then((places) => {
          setNearbyPlaces(places);
          setPlacesFetched(true);
          setPlacesLoading(false);
        });
      }

      if (detectedFaceCount > 0) {
        const topExpr = faceExpressions[0] ? (EXPRESSION_EN[faceExpressions[0]] ?? faceExpressions[0]) : null;
        setFaceMessage(`${detectedFaceCount} face(s) detected!${topExpr ? ` · ${topExpr}` : ""} Saving...`);
        try {
          const { data: { user } } = await supabase.auth.getUser();
          const uid = user?.id ?? "guest";
          const dataUrl = await createThumbnailDataUrl(file, 600, 0.85);
          const facePhotoId = crypto.randomUUID();
          const facePhoto: FacePhoto = {
            id: facePhotoId,
            fileName: file.name,
            imageUrl: dataUrl,
            faceCount: detectedFaceCount,
            uploadedAt: new Date().toISOString(),
            ...(faceBoxes.length > 0       && { boxes: faceBoxes }),
            ...(faceDescriptors.length > 0 && { descriptors: faceDescriptors }),
            ...(faceConfidences.length > 0 && { confidences: faceConfidences }),
            ...(faceAges.length > 0        && { ages: faceAges }),
            ...(faceGenders.length > 0     && { genders: faceGenders }),
            ...(faceExpressions.length > 0 && { expressions: faceExpressions }),
            ...(lat !== null               && { lat }),
            ...(lng !== null               && { lng }),
            ...(location !== "No GPS data" && { location }),
          };
          const facesKey = `faces-${uid}`;
          const existing: FacePhoto[] = JSON.parse(localStorage.getItem(facesKey) ?? "[]");
          localStorage.setItem(facesKey, JSON.stringify([facePhoto, ...existing]));
          setLastFacePhotoId(facePhotoId);
          setFaceMessage(`${detectedFaceCount} face(s) detected!${topExpr ? ` · ${topExpr}` : ""} Saved to Faces album.`);
        } catch (saveErr) {
          console.error("Face photo save failed:", saveErr);
          setFaceMessage(`${detectedFaceCount} face(s) detected! (Save failed)`);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
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
    const mapKey   = `map-${uid}`;
    const facesKey = `faces-${uid}`;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      items[i] = { ...items[i], status: "processing" };
      setBatchItems([...items]);

      try {
        const exifData: any = await exifr.parse(file).catch(() => null);
        const gpsData:  any = await exifr.gps(file).catch(() => null);
        const lat = typeof gpsData?.latitude  === "number" ? gpsData.latitude  : undefined;
        const lng = typeof gpsData?.longitude === "number" ? gpsData.longitude : undefined;

        let captureDate: string | undefined;
        let captureTime: string | undefined;
        let location:    string | undefined;

        const takenAt = exifData?.DateTimeOriginal || exifData?.CreateDate || null;
        if (takenAt) {
          const d = new Date(takenAt);
          captureDate = d.toLocaleDateString();
          captureTime = d.toLocaleTimeString();
        }
        if (lat !== undefined && lng !== undefined) {
          const addr = await reverseGeocode(lat, lng);
          location = addr || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        }

        let faceCount = 0;
        let faceBoxes:    Array<{ x: number; y: number; width: number; height: number }> = [];
        let faceDescriptors: number[][] = [];
        let faceConfs:    number[] = [];
        let faceAgesB:    number[] = [];
        let faceGendersB: string[] = [];
        let faceExprsB:   string[] = [];

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

        const dataUrl   = await createThumbnailDataUrl(file, 600, 0.85);
        const photoId   = crypto.randomUUID();

        const mapPhotos: MapPhoto[]  = JSON.parse(localStorage.getItem(mapKey)   ?? "[]");
        mapPhotos.unshift({ id: photoId, fileName: file.name, imageUrl: dataUrl, lat, lng, location, captureDate, captureTime, uploadedAt: new Date().toISOString(), faceCount });
        localStorage.setItem(mapKey, JSON.stringify(mapPhotos));

        if (faceCount > 0) {
          const facePhotos: FacePhoto[] = JSON.parse(localStorage.getItem(facesKey) ?? "[]");
          facePhotos.unshift({
            id: crypto.randomUUID(), fileName: file.name, imageUrl: dataUrl,
            faceCount, uploadedAt: new Date().toISOString(),
            ...(faceBoxes.length > 0       && { boxes: faceBoxes }),
            ...(faceDescriptors.length > 0 && { descriptors: faceDescriptors }),
            ...(faceConfs.length > 0       && { confidences: faceConfs }),
            ...(faceAgesB.length > 0       && { ages: faceAgesB }),
            ...(faceGendersB.length > 0    && { genders: faceGendersB }),
            ...(faceExprsB.length > 0      && { expressions: faceExprsB }),
            ...(lat !== undefined          && { lat }),
            ...(lng !== undefined          && { lng }),
            ...(location                   && { location }),
          });
          localStorage.setItem(facesKey, JSON.stringify(facePhotos));
        }

        const infoParts: string[] = [];
        if (faceCount > 0) infoParts.push(`${faceCount} face(s)`);
        infoParts.push(location ? location.split(",")[0] : "No GPS");
        items[i] = { name: file.name, status: "done", info: infoParts.join(" · ") };
      } catch (err) {
        console.error(`Batch error [${file.name}]:`, err);
        items[i] = { name: file.name, status: "error", info: "Failed" };
      }

      setBatchItems([...items]);
    }

    refreshStats();
  }

  function resetBatch() {
    setBatchActive(false);
    setBatchItems([]);
  }

  function startEditName() { setDraftFileName(customFileName); setIsEditingName(true); }
  async function saveEditedName() {
    const newName = draftFileName.trim();
    if (newName) {
      setCustomFileName(newName);
      if (lastFacePhotoId) {
        const { data: { user } } = await supabase.auth.getUser();
        const uid = user?.id ?? "guest";
        const facesKey = `faces-${uid}`;
        const photos: FacePhoto[] = JSON.parse(localStorage.getItem(facesKey) ?? "[]");
        const idx = photos.findIndex((p) => p.id === lastFacePhotoId);
        if (idx >= 0) {
          photos[idx].fileName = newName;
          localStorage.setItem(facesKey, JSON.stringify(photos));
        }
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
      const dataUrl = await createThumbnailDataUrl(selectedFile, 420, 0.6);
      const photoId = crypto.randomUUID();
      const photo: MapPhoto = {
        id: photoId,
        fileName: customFileName.trim() || selectedFile.name,
        imageUrl: dataUrl,
        lat: effectiveLat,
        lng: effectiveLng,
        location: manualCoords?.name ?? photoInfo.location,
        captureDate: photoInfo.captureDate !== "Not available" ? photoInfo.captureDate : undefined,
        captureTime: photoInfo.captureTime !== "Not available" ? photoInfo.captureTime : undefined,
        uploadedAt: new Date().toISOString(),
        faceCount: photoInfo.faceCount,
      };
      const mapKey = `map-${uid}`;
      const existing: MapPhoto[] = JSON.parse(localStorage.getItem(mapKey) ?? "[]");
      localStorage.setItem(mapKey, JSON.stringify([photo, ...existing]));
      setSavedMessage("Saved to map and albums!");
      refreshStats();
    } catch (err) {
      console.error("Save to map failed:", err);
      setSavedMessage(`Save failed: ${err instanceof Error ? err.message : "Please try again."}`);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8 pb-28">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <AppLogo size="md" className="shadow-md shadow-blue-200" />
            <h1 className="text-4xl font-extrabold tracking-tight">
              Travel<span className="bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent">ries</span>
            </h1>
          </div>
          <p className="text-slate-500 ml-[52px] text-sm">Upload travel photos to automatically analyze location &amp; faces.</p>
        </div>

        {/* ── Dashboard Stats ── */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: "Photos Saved",   value: dashStats.totalPhotos,    icon: Camera, color: "bg-blue-500"    },
            { label: "Places Visited", value: dashStats.totalLocations, icon: MapPin, color: "bg-emerald-500" },
            { label: "Faces Detected", value: dashStats.totalFaces,     icon: Users,  color: "bg-rose-500"    },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3">
              <div className={`w-9 h-9 ${color} rounded-xl flex items-center justify-center flex-shrink-0`}>
                <Icon size={17} className="text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-extrabold text-slate-900 leading-tight">{value}</p>
                <p className="text-[11px] text-slate-400 font-medium truncate">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Batch Upload UI ── */}
        {batchActive && (() => {
          const done  = batchItems.filter((b) => b.status === "done" || b.status === "error").length;
          const total = batchItems.length;
          const allDone = done === total && total > 0;
          const saved = batchItems.filter((b) => b.status === "done").length;
          const totalFacesFound = batchItems.filter((b) => b.info.includes("face")).reduce((sum, b) => {
            const m = b.info.match(/(\d+) face/);
            return sum + (m ? parseInt(m[1]) : 0);
          }, 0);
          return (
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-500 rounded-xl flex items-center justify-center">
                    <Upload size={16} className="text-white" />
                  </div>
                  <div>
                    <h2 className="font-bold text-slate-800">Batch Upload</h2>
                    <p className="text-xs text-slate-400">{done} / {total} processed</p>
                  </div>
                </div>
                {allDone && (
                  <button onClick={resetBatch}
                    className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors">
                    <X size={14} /> Close
                  </button>
                )}
              </div>

              {/* Progress bar */}
              <div className="px-6 pt-4 pb-2">
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{ width: total > 0 ? `${Math.round((done / total) * 100)}%` : "0%" }} />
                </div>
                <p className="text-xs text-slate-400 mt-1.5">{total > 0 ? Math.round((done / total) * 100) : 0}% complete</p>
              </div>

              {/* File list */}
              <div className="px-6 pb-4 space-y-2 max-h-72 overflow-y-auto">
                {batchItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                    {item.status === "pending"    && <div className="w-5 h-5 rounded-full border-2 border-slate-300 flex-shrink-0" />}
                    {item.status === "processing" && <Loader2 size={18} className="text-blue-500 animate-spin flex-shrink-0" />}
                    {item.status === "done"       && <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />}
                    {item.status === "error"      && <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{item.name}</p>
                      <p className={`text-xs mt-0.5 ${item.status === "error" ? "text-red-400" : "text-slate-400"}`}>
                        {item.info || (item.status === "pending" ? "Waiting..." : item.status === "processing" ? "Processing..." : "")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Done summary */}
              {allDone && (
                <div className="px-6 pb-5">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3">
                    <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-emerald-700">{saved} photo(s) saved!</p>
                      {totalFacesFound > 0 && (
                        <p className="text-xs text-emerald-600 mt-0.5">{totalFacesFound} face(s) detected and saved to Faces album.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          );
        })()}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Upload Section ── */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Upload Photo</h2>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  backendStatus === "online"   ? "bg-emerald-500" :
                  backendStatus === "offline"  ? "bg-slate-400"   : "bg-amber-400"
                }`} />
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  {backendStatus === "online"   ? <><Wifi size={12} /> API Connected</> :
                   backendStatus === "offline"  ? <><WifiOff size={12} /> Browser Mode</> :
                   "Checking..."}
                </span>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Drop zone */}
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl p-10 cursor-pointer bg-slate-50 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 group">
                <input type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
                <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mb-3 group-hover:bg-blue-200 transition-colors">
                  <Upload size={26} className="text-blue-600" />
                </div>
                <p className="font-semibold text-slate-700 group-hover:text-blue-700 transition-colors">Click to select photos</p>
                <p className="text-xs text-slate-400 mt-1">JPG, PNG, HEIC, etc.</p>
                {!isModelLoaded && (
                  <p className="mt-2 text-xs text-slate-400 flex items-center gap-1">
                    <Loader2 size={12} className="animate-spin" /> Loading AI engine...
                  </p>
                )}
                {isModelLoaded && modelType === "ssd" && hasExtraModels && (
                  <p className="mt-2 text-xs text-emerald-600 flex items-center gap-1 font-medium">
                    <CheckCircle2 size={12} /> Premium Mode (SSD + Age/Gender + Expression)
                  </p>
                )}
                {isModelLoaded && modelType === "ssd" && !hasExtraModels && (
                  <p className="mt-2 text-xs text-emerald-600 flex items-center gap-1 font-medium">
                    <CheckCircle2 size={12} /> Advanced Mode (SSD + Face Recognition)
                  </p>
                )}
                {isModelLoaded && modelType === "tiny" && (
                  <p className="mt-2 text-xs text-amber-500 flex items-center gap-1">
                    <AlertTriangle size={12} /> Basic Mode (Multi-scale)
                  </p>
                )}
              </label>

              {/* Loading */}
              {loading && (
                <div className="flex items-center justify-center gap-2 text-blue-600 py-2 text-sm font-medium">
                  <Loader2 size={16} className="animate-spin" />
                  Analyzing...
                </div>
              )}

              {/* Face detection message */}
              {faceMessage && (
                <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                  <Users size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm font-semibold text-blue-700">{faceMessage}</p>
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
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-bold py-2.5 rounded-xl transition-colors"
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
                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
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

              {/* File name edit + save button */}
              {photoInfo && (
                <div className="space-y-3 pt-1">
                  {isEditingName ? (
                    <div className="flex gap-2">
                      <input
                        value={draftFileName}
                        onChange={(e) => setDraftFileName(e.target.value)}
                        className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                      />
                      <button onClick={saveEditedName}
                        className="bg-blue-600 text-white px-3 py-2 rounded-xl hover:bg-blue-700 transition-colors">
                        <Check size={16} />
                      </button>
                      <button onClick={() => setIsEditingName(false)}
                        className="bg-slate-100 text-slate-600 px-3 py-2 rounded-xl hover:bg-slate-200 transition-colors">
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-4 py-2.5 border border-slate-100">
                      <FileImage size={14} className="text-slate-400 flex-shrink-0" />
                      <span className="flex-1 text-sm text-slate-700 truncate">{customFileName}</span>
                      <button onClick={startEditName}
                        className="text-slate-400 hover:text-slate-700 transition-colors p-1">
                        <Pencil size={14} />
                      </button>
                    </div>
                  )}

                  <button onClick={handleSaveToMap}
                    className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-700 text-white py-3.5 rounded-xl font-bold text-sm transition-colors shadow-lg shadow-slate-200">
                    <Save size={16} /> Save to Map
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
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
              <Cpu size={18} className="text-slate-500" />
              <h2 className="text-lg font-bold text-slate-800">Analysis Result</h2>
            </div>

            <div className="p-6">
              {photoInfo && previewUrl ? (
                <div className="space-y-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt={customFileName}
                    className="w-full max-h-64 object-cover rounded-xl border border-slate-100"
                  />

                  {/* Face count banner */}
                  <div className={`flex items-center justify-between rounded-xl px-4 py-3 border ${
                    photoInfo.faceCount > 0
                      ? "bg-blue-50 border-blue-200"
                      : "bg-slate-50 border-slate-200"
                  }`}>
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">AI Classification</p>
                      <p className={`font-extrabold text-lg ${photoInfo.faceCount > 0 ? "text-blue-700" : "text-slate-700"}`}>
                        {photoInfo.category}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-3xl font-extrabold ${photoInfo.faceCount > 0 ? "text-blue-600" : "text-slate-300"}`}>
                        {photoInfo.faceCount}
                      </p>
                      <p className="text-xs text-slate-400">detected</p>
                    </div>
                  </div>

                  {/* Info grid */}
                  <div className="grid grid-cols-2 gap-2">
                    <InfoRow label="File name"    value={customFileName}        icon={FileImage}   />
                    <InfoRow label="File size"    value={photoInfo.fileSize}    icon={Ruler}       />
                    <InfoRow label="Capture date" value={photoInfo.captureDate} icon={CalendarDays}/>
                    <InfoRow label="Capture time" value={photoInfo.captureTime} icon={Clock}       />
                    <InfoRow label="Location"     value={photoInfo.location}    icon={MapPin}      />
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
                <div className="h-80 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
                    <Camera size={28} className="text-slate-300" />
                  </div>
                  <p className="text-slate-400 text-sm">Select a photo to see the analysis results here</p>
                </div>
              )}
            </div>
          </section>

        </div>

        {/* ── Highlights ── */}
        {(highlights.recent || (highlights.mostFaces && (highlights.mostFaces.faceCount ?? 0) > 0)) && (
          <section className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 bg-slate-50">
              <Sparkles size={16} className="text-amber-400" />
              <h2 className="font-bold text-slate-800">Highlights</h2>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              {highlights.recent && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Clock size={9} /> Recent Upload
                  </p>
                  <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={highlights.recent.imageUrl} alt={highlights.recent.fileName} className="w-full h-28 object-contain bg-slate-100" />
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
                </div>
              )}
              {highlights.mostFaces && (highlights.mostFaces.faceCount ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Users size={9} /> Most Faces
                  </p>
                  <div className="rounded-xl overflow-hidden border border-blue-200 bg-slate-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={highlights.mostFaces.imageUrl} alt={highlights.mostFaces.fileName} className="w-full h-28 object-contain bg-slate-100" />
                    <div className="p-2.5">
                      <p className="text-xs font-bold text-slate-800 truncate">{highlights.mostFaces.fileName}</p>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full mt-1">
                        <Users size={8} /> {highlights.mostFaces.faceCount} face(s)
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

      </div>

      <BottomNav />
    </main>
  );
}
