"use client";

import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import type { PilgrimagePoint } from "../../lib/types";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";

// Orange custom marker
const markerIcon = new L.Icon({
  iconUrl:
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="%23FF8400"/><circle cx="12" cy="12" r="5" fill="white"/></svg>',
    ),
  iconSize: [24, 36],
  iconAnchor: [12, 36],
  popupAnchor: [0, -36],
});

function FitBounds({ points }: { points: PilgrimagePoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(
      points
        .filter((p) => p.latitude && p.longitude)
        .map((p) => [p.latitude, p.longitude] as [number, number]),
    );
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [map, points]);

  return null;
}

interface PilgrimageMapProps {
  points: PilgrimagePoint[];
  route?: PilgrimagePoint[];
  height?: number | string;
  scrollWheelZoom?: boolean;
}

export default function PilgrimageMap({
  points,
  route,
  height = 300,
  scrollWheelZoom: scrollWheelZoomProp,
}: PilgrimageMapProps) {
  // Enable scroll zoom when route is present (fullscreen map)
  const scrollWheelZoom = scrollWheelZoomProp ?? !!route;
  const validPoints = points.filter((p) => p.latitude && p.longitude);
  const center =
    validPoints.length > 0
      ? ([validPoints[0].latitude, validPoints[0].longitude] as [number, number])
      : ([35.68, 139.76] as [number, number]); // default: Tokyo

  const routeCoords = route
    ?.filter((p) => p.latitude && p.longitude)
    .map((p) => [p.latitude, p.longitude] as [number, number]);

  return (
    <MapContainer
      center={center}
      zoom={13}
      style={{ height, width: "100%" }}
      scrollWheelZoom={scrollWheelZoom}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url={`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`}
        tileSize={512}
        zoomOffset={-1}
      />
      <FitBounds points={validPoints} />

      {validPoints.map((point, idx) => (
        <Marker
          key={point.id}
          position={[point.latitude, point.longitude]}
          icon={markerIcon}
        >
          <Popup>
            <strong>{route ? `${idx + 1}. ` : ""}{point.name_cn || point.name}</strong>
            <br />
            {point.title_cn || point.title} · 第{point.episode}話
          </Popup>
        </Marker>
      ))}

      {routeCoords && routeCoords.length > 1 && (
        <Polyline
          positions={routeCoords}
          pathOptions={{ color: "#FF8400", weight: 3, opacity: 0.8 }}
        />
      )}
    </MapContainer>
  );
}
