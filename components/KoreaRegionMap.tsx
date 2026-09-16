"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPhoto } from "@/lib/types";
import {
  ProvinceGeoData, buildProjection, geometryToPath, geometryBBox,
  matchRegionCode, REGION_LABELS,
} from "@/lib/koreaGeo";

let geoPromise: Promise<ProvinceGeoData> | null = null;
function loadGeo(): Promise<ProvinceGeoData> {
  if (!geoPromise) geoPromise = fetch("/data/skorea-provinces.geo.json").then((r) => r.json());
  return geoPromise;
}

const VIEW_W = 640;

type Region = {
  code: string;
  label: string;
  path: string;
  bbox: { x: number; y: number; width: number; height: number };
  photos: MapPhoto[];
  // Most recent photo in the region — the one shape-filled onto the province.
  repPhoto: MapPhoto | null;
};

export default function KoreaRegionMap({
  photos, selectedRegion, onSelectRegion,
}: {
  photos: MapPhoto[];
  selectedRegion: string | null;
  onSelectRegion: (code: string | null) => void;
}) {
  const [geo, setGeo] = useState<ProvinceGeoData | null>(null);

  useEffect(() => {
    loadGeo().then(setGeo).catch((err) => console.error("Failed to load province map:", err));
  }, []);

  const projected = useMemo(() => (geo ? buildProjection(geo, VIEW_W) : null), [geo]);

  const regions = useMemo<Region[]>(() => {
    if (!geo || !projected) return [];
    return geo.features.map((f) => {
      const code = f.properties.code;
      const regionPhotos = photos
        .filter((p) => matchRegionCode(p.location) === code)
        .sort((a, b) => (a.captureTimestamp ?? a.uploadedAt ?? "").localeCompare(b.captureTimestamp ?? b.uploadedAt ?? ""));
      return {
        code,
        label: REGION_LABELS[code] ?? f.properties.name,
        path: geometryToPath(f.geometry, projected.project),
        bbox: geometryBBox(f.geometry, projected.project),
        photos: regionPhotos,
        repPhoto: regionPhotos[regionPhotos.length - 1] ?? null,
      };
    });
  }, [geo, projected, photos]);

  if (!geo || !projected) {
    return (
      <div className="h-[380px] w-full rounded-2xl border border-slate-200 bg-white flex items-center justify-center text-slate-400 text-sm">
        Loading map…
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl overflow-hidden shadow-sm border border-slate-200 bg-white p-3">
      <svg viewBox={`0 0 ${VIEW_W} ${projected.viewH}`} className="w-full h-auto block" style={{ maxHeight: 480 }}>
        <defs>
          {regions.map((r) => (
            <clipPath id={`region-clip-${r.code}`} key={`defclip-${r.code}`}>
              <path d={r.path} />
            </clipPath>
          ))}
        </defs>

        {regions.map((r) => {
          const isSelected = selectedRegion === r.code;
          return (
            <g key={r.code}>
              {r.repPhoto ? (
                <g clipPath={`url(#region-clip-${r.code})`}>
                  <image
                    href={r.repPhoto.imageUrl}
                    x={r.bbox.x} y={r.bbox.y} width={r.bbox.width} height={r.bbox.height}
                    preserveAspectRatio="xMidYMid slice"
                  />
                </g>
              ) : (
                <path d={r.path} fill="#e2e8f0" />
              )}
              <path
                d={r.path}
                fill={isSelected ? "rgba(37,99,235,0.25)" : "transparent"}
                stroke={isSelected ? "#2563eb" : "#ffffff"}
                strokeWidth={isSelected ? 3 : 1.5}
                className="cursor-pointer transition-colors hover:fill-blue-500/10"
                onClick={() => onSelectRegion(isSelected ? null : r.code)}
              />
              <text
                x={r.bbox.x + r.bbox.width / 2} y={r.bbox.y + r.bbox.height / 2}
                textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={700}
                fill={r.photos.length > 0 ? "#fff" : "#94a3b8"}
                style={{ pointerEvents: "none", paintOrder: "stroke", stroke: r.photos.length > 0 ? "rgba(0,0,0,0.45)" : "none", strokeWidth: 3 }}
              >
                {r.label}{r.photos.length > 0 ? ` (${r.photos.length})` : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
