// Helpers for the Map page's "Regions" view (components/KoreaRegionMap.tsx) — turns
// public/data/skorea-provinces.geo.json (17 시/도 boundaries, source: southkorea/southkorea-maps,
// KOSTAT 2013 simplified) into SVG paths, and matches a photo's reverse-geocoded
// `location` string to one of those provinces.

export type Ring = [number, number][];
export type Geometry =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] };
export type ProvinceFeature = {
  type: "Feature";
  properties: { code: string; name: string; name_eng: string };
  geometry: Geometry;
};
export type ProvinceGeoData = { type: "FeatureCollection"; features: ProvinceFeature[] };

export type Project = (pt: [number, number]) => [number, number];

// Equirectangular projection with a cos(latitude) correction on longitude so
// shapes aren't horizontally stretched — accurate enough at Korea's latitude
// range (~33-39°N) without pulling in a full projection library.
export function buildProjection(geo: ProvinceGeoData, viewW: number): { project: Project; viewH: number } {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const f of geo.features) {
    for (const ring of ringsOf(f.geometry)) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  const cos = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const rawMinX = minLng * cos, rawMaxX = maxLng * cos;
  const rawW = rawMaxX - rawMinX, rawH = maxLat - minLat;
  const scale = viewW / rawW;
  const viewH = rawH * scale;

  const project: Project = ([lng, lat]) => {
    const x = (lng * cos - rawMinX) * scale;
    const y = (maxLat - lat) * scale; // flip: higher latitude → smaller y (top of the SVG)
    return [x, y];
  };
  return { project, viewH };
}

function ringsOf(geometry: Geometry): Ring[] {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

export function geometryToPath(geometry: Geometry, project: Project): string {
  return ringsOf(geometry)
    .map((ring) => ring.map(([lng, lat], i) => {
      const [x, y] = project([lng, lat]);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ") + " Z")
    .join(" ");
}

export function geometryBBox(geometry: Geometry, project: Project): { x: number; y: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of ringsOf(geometry)) {
    for (const pt of ring) {
      const [x, y] = project(pt);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Reverse-geocoded `location` strings (geopy/Nominatim, English) spell provinces
// differently depending on OSM data vintage — old KOSTAT-style "Gangwon-do" vs.
// post-2023 special-autonomy renames like "Gangwon State" — so match on a root
// substring rather than the exact GeoJSON name_eng.
const REGION_ALIASES: Record<string, string[]> = {
  "11": ["seoul"],
  "21": ["busan"],
  "22": ["daegu"],
  "23": ["incheon"],
  "24": ["gwangju"],
  "25": ["daejeon"],
  "26": ["ulsan"],
  "29": ["sejong"],
  "31": ["gyeonggi"],
  "32": ["gangwon"],
  "33": ["chungcheongbuk", "chungbuk"],
  "34": ["chungcheongnam", "chungnam"],
  "35": ["jeollabuk", "jeonbuk"],
  "36": ["jeollanam", "jeonnam"],
  "37": ["gyeongsangbuk", "gyeongbuk"],
  "38": ["gyeongsangnam", "gyeongnam"],
  "39": ["jeju"],
};

export const REGION_LABELS: Record<string, string> = {
  "11": "서울", "21": "부산", "22": "대구", "23": "인천", "24": "광주", "25": "대전", "26": "울산", "29": "세종",
  "31": "경기", "32": "강원", "33": "충북", "34": "충남", "35": "전북", "36": "전남", "37": "경북", "38": "경남", "39": "제주",
};

export function matchRegionCode(location: string | undefined): string | null {
  if (!location) return null;
  const norm = location.toLowerCase();
  for (const [code, aliases] of Object.entries(REGION_ALIASES)) {
    if (aliases.some((a) => norm.includes(a))) return code;
  }
  return null;
}
