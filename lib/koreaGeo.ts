// Helpers for the Map page's "Regions" view (components/KoreaRegionMap.tsx) — turns
// public/data/skorea-provinces.geo.json (17 시/도 boundaries, source: southkorea/southkorea-maps,
// KOSTAT 2013 simplified) into SVG paths, and finds which province a photo is in.

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

function polygonsOf(geometry: Geometry): Ring[][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}

type BBox = { x: number; y: number; width: number; height: number };

function ringsBBox(rings: Ring[], project: Project): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
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

// Where a province's photo and label go. Incheon is 18 islands reaching out to
// Baengnyeong-do, so a photo spread over its whole bbox showed only as slivers on
// tiny islands; this uses just the main land masses (polygons at least `minShare`
// of the largest) and labels the centre of the largest one.
export function provinceLayout(geometry: Geometry, project: Project, minShare = 0.2): { imageBox: BBox; labelAt: [number, number] } {
  const polys = polygonsOf(geometry).map((p) => ({ outer: p[0], area: ringArea(p[0]) }));
  const largest = Math.max(...polys.map((p) => p.area));
  const imageBox = ringsBBox(polys.filter((p) => p.area >= largest * minShare).map((p) => p.outer), project);
  const main = ringsBBox([polys.find((p) => p.area === largest)!.outer], project);
  return { imageBox, labelAt: [main.x + main.width / 2, main.y + main.height / 2] };
}

// Gyeonggi surrounds Seoul, so the centre of its outline is in Seoul and the two
// labels collided ("서울 (5)) (3)"); Incheon's mainland label touched Seoul's too.
// [lng, lat] points inside the province instead (Incheon's is on Ganghwa-do).
export const LABEL_LNG_LAT: Record<string, [number, number]> = {
  "31": [127.42, 37.92],
  "23": [126.45, 37.71],
};

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

const REGION_LABELS_EN: Record<string, string> = {
  "11": "Seoul", "21": "Busan", "22": "Daegu", "23": "Incheon", "24": "Gwangju", "25": "Daejeon", "26": "Ulsan", "29": "Sejong",
  "31": "Gyeonggi", "32": "Gangwon", "33": "N. Chungcheong", "34": "S. Chungcheong", "35": "N. Jeolla", "36": "S. Jeolla",
  "37": "N. Gyeongsang", "38": "S. Gyeongsang", "39": "Jeju",
};

/** A province's short name in the UI language. */
export function regionLabel(code: string, lang: "en" | "ko"): string | undefined {
  return (lang === "ko" ? REGION_LABELS : REGION_LABELS_EN)[code];
}

export function matchRegionCode(location: string | undefined): string | null {
  if (!location) return null;
  const norm = location.toLowerCase();
  for (const [code, aliases] of Object.entries(REGION_ALIASES)) {
    if (aliases.some((a) => norm.includes(a))) return code;
  }
  return null;
}

let geoPromise: Promise<ProvinceGeoData> | null = null;
export function loadProvinceGeo(): Promise<ProvinceGeoData> {
  if (!geoPromise) {
    geoPromise = fetch("/data/skorea-provinces.geo.json").then((r) => r.json());
    geoPromise.catch(() => { geoPromise = null; });
  }
  return geoPromise;
}

// Even-odd ray casting over every ring, so holes in a province count as outside.
export function pointInGeometry(lng: number, lat: number, geometry: Geometry): boolean {
  let inside = false;
  for (const ring of ringsOf(geometry)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// A photo on a beach or a boat can fall just outside the simplified coastline.
const COAST_SNAP_DEG = 0.15; // ~15 km

// Which province a photo is in. Coordinates come first: the browser's reverse
// geocode reads "road, neighbourhood, district, city" with no province, so a
// Gangneung or Namyangju photo never matched by name and was missing from Regions
// (only Seoul matched, because its city name is the province). The location text
// is the fallback for photos without coordinates.
export function regionCodeOf(
  photo: { lat?: number; lng?: number; location?: string },
  geo: ProvinceGeoData,
): string | null {
  const { lat, lng } = photo;
  if (lat != null && lng != null) {
    for (const f of geo.features) {
      if (pointInGeometry(lng, lat, f.geometry)) return f.properties.code;
    }
    let best: string | null = null, bestD = COAST_SNAP_DEG;
    for (const f of geo.features) {
      for (const ring of ringsOf(f.geometry)) {
        for (const [x, y] of ring) {
          const d = Math.hypot(x - lng, y - lat);
          if (d < bestD) { bestD = d; best = f.properties.code; }
        }
      }
    }
    if (best) return best;
  }
  return matchRegionCode(photo.location);
}
