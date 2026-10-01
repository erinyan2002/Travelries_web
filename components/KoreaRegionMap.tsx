"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPhoto } from "@/lib/types";
import {
  ProvinceGeoData, buildProjection, geometryToPath, provinceLayout, LABEL_LNG_LAT,
  regionCodeOf, loadProvinceGeo, regionLabel,
} from "@/lib/koreaGeo";
import { useLang } from "@/lib/i18n";

const VIEW_W = 640;

type Region = {
  code: string;
  label: string;
  path: string;
  imageBox: { x: number; y: number; width: number; height: number };
  labelAt: [number, number];
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
  const { t, lang } = useLang();

  useEffect(() => {
    loadProvinceGeo().then(setGeo).catch((err) => console.error("Failed to load province map:", err));
  }, []);

  const projected = useMemo(() => (geo ? buildProjection(geo, VIEW_W) : null), [geo]);

  const regions = useMemo<Region[]>(() => {
    if (!geo || !projected) return [];
    return geo.features.map((f) => {
      const code = f.properties.code;
      const regionPhotos = photos
        .filter((p) => regionCodeOf(p, geo) === code)
        .sort((a, b) => (a.captureTimestamp ?? a.uploadedAt ?? "").localeCompare(b.captureTimestamp ?? b.uploadedAt ?? ""));
      return {
        code,
        label: regionLabel(code, lang) ?? f.properties.name,
        path: geometryToPath(f.geometry, projected.project),
        ...(() => {
          const { imageBox, labelAt } = provinceLayout(f.geometry, projected.project);
          const fixed = LABEL_LNG_LAT[code];
          return { imageBox, labelAt: fixed ? projected.project(fixed) : labelAt };
        })(),
        photos: regionPhotos,
        repPhoto: regionPhotos[regionPhotos.length - 1] ?? null,
      };
    });
  }, [geo, projected, photos, lang]);

  if (!geo || !projected) {
    return (
      <div className="h-[380px] w-full rounded-2xl border border-slate-200 bg-white flex items-center justify-center text-slate-400 text-sm">
        {t("Loading map…")}
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
                    x={r.imageBox.x} y={r.imageBox.y} width={r.imageBox.width} height={r.imageBox.height}
                    preserveAspectRatio="xMidYMid slice"
                  />
                </g>
              ) : (
                <path d={r.path} fill="#e2e8f0" />
              )}
              <path
                d={r.path}
                fill={isSelected ? "rgba(2,132,199,0.25)" : "transparent"}
                stroke={isSelected ? "#0369a1" : "#ffffff"}
                strokeWidth={isSelected ? 3 : 1.5}
                className="cursor-pointer transition-colors hover:fill-blue-500/10"
                onClick={() => onSelectRegion(isSelected ? null : r.code)}
              />
              <text
                x={r.labelAt[0]} y={r.labelAt[1]}
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
