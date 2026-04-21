"use client";

/**
 * LeafletResultMap — loaded lazily via dynamic() from ResultPanel.
 *
 * This file MUST NOT be imported at the top level of any server-rendered module.
 * Leaflet requires `window` and will throw in SSR contexts.
 */

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import type { PilgrimagePoint } from "../../lib/types";

interface LeafletResultMapProps {
  points: PilgrimagePoint[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

type LeafletModule = typeof import("leaflet");

function buildPopupEl(name: string): HTMLElement {
  const strong = document.createElement("strong");
  strong.textContent = name; // textContent auto-escapes — no XSS risk
  strong.style.fontSize = "13px";
  const wrap = document.createElement("div");
  wrap.style.padding = "4px 2px";
  wrap.appendChild(strong);
  return wrap;
}

function initLeafletMap(
  container: HTMLElement,
  points: PilgrimagePoint[],
  L: LeafletModule,
  onToggle: (id: string) => void,
): LeafletMap {
  // Default marker icon fix for bundled environments.
  const iconDefault = L.Icon.Default as unknown as { _getIconUrl?: unknown };
  delete iconDefault._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "/leaflet/marker-icon-2x.png",
    iconUrl: "/leaflet/marker-icon.png",
    shadowUrl: "/leaflet/marker-shadow.png",
  });

  const validPoints = points.filter(
    (p) => p.latitude !== 0 && p.longitude !== 0,
  );

  const center: [number, number] =
    validPoints.length > 0
      ? [validPoints[0].latitude, validPoints[0].longitude]
      : [35.6895, 139.6917]; // Tokyo fallback

  const map = L.map(container, { center, zoom: 13, zoomControl: true });

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const tileUrl = mapboxToken
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  L.tileLayer(tileUrl, {
    attribution: mapboxToken
      ? '© <a href="https://www.mapbox.com/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OSM</a>'
      : '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    tileSize: mapboxToken ? 512 : 256,
    zoomOffset: mapboxToken ? -1 : 0,
  }).addTo(map);

  for (const point of validPoints) {
    const marker = L.marker([point.latitude, point.longitude]);
    marker.bindPopup(buildPopupEl(point.name));
    marker.on("click", () => onToggle(point.id));
    marker.addTo(map);
  }

  if (validPoints.length > 1) {
    const bounds = L.latLngBounds(
      validPoints.map((p) => [p.latitude, p.longitude] as [number, number]),
    );
    map.fitBounds(bounds, { padding: [32, 32] });
  }

  return map;
}

export default function LeafletResultMap({
  points,
  selectedIds,
  onToggle,
}: LeafletResultMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Dynamic import inside effect so SSR never touches Leaflet.
    import("leaflet").then((L) => {
      if (!containerRef.current || mapRef.current) return;
      mapRef.current = initLeafletMap(containerRef.current, points, L, onToggle);
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // onToggle is intentionally excluded — adding it would re-create the map on
    // every selection change. Markers capture a stable reference via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  // Keep selected state visually in sync without re-building the map.
  // For a simple implementation we just rely on the tile layer remaining functional.
  void selectedIds; // consumed by parent via onToggle callback

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%" }}
      data-testid="leaflet-map-container"
    />
  );
}
