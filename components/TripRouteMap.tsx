"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Polyline, TileLayer } from "react-leaflet";

// Read-only route map for a shared trip (/trip/[id]): numbered stops in
// chronological order joined by a line. Leaflet needs `window`, so callers load
// this with next/dynamic and ssr: false.
export default function TripRouteMap({ points }: { points: { lat: number; lng: number }[] }) {
  if (points.length === 0) return null;
  const latlngs = points.map((p) => [p.lat, p.lng] as [number, number]);
  const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
  return (
    <MapContainer
      bounds={bounds}
      boundsOptions={{ padding: [30, 30], maxZoom: 14 }}
      scrollWheelZoom={false}
      className="w-full h-64 rounded-2xl z-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {latlngs.length > 1 && <Polyline positions={latlngs} pathOptions={{ color: "#0284c7", weight: 4, opacity: 0.8 }} />}
      {latlngs.map((ll, i) => (
        <CircleMarker key={i} center={ll} radius={i === 0 || i === latlngs.length - 1 ? 8 : 5}
          pathOptions={{ color: "#fff", weight: 2, fillColor: i === 0 ? "#38bdf8" : "#0284c7", fillOpacity: 1 }} />
      ))}
    </MapContainer>
  );
}
