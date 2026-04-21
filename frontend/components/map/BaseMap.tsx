"use client";

/**
 * BaseMap — unified Mapbox GL JS map component.
 *
 * Uses react-map-gl (Mapbox GL JS) for vector tiles, GPU rendering,
 * and smooth interactions. All map rendering goes through this single component.
 *
 * MUST be loaded via dynamic(() => import(...), { ssr: false }) —
 * Mapbox GL requires `window`.
 */

import { useCallback, useMemo, useState } from "react";
import Map, { Marker, Popup, Source, Layer, NavigationControl } from "react-map-gl/mapbox";
import type { MapRef } from "react-map-gl/mapbox";
import type { PilgrimagePoint } from "../../lib/types";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BaseMapProps {
  /** Points to display as markers. */
  points: PilgrimagePoint[];
  /** Height of the map container. Default: "100%". */
  height?: number | string;
  /** Mapbox style URL. Default: streets-v12. */
  mapStyle?: string;
  /** Enable scroll wheel zoom. Default: false. */
  scrollWheelZoom?: boolean;

  // ── Selection (search results mode) ──
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;

  // ── Route mode ──
  route?: PilgrimagePoint[];

  // ── Performance measurement ──
  onAllTilesLoaded?: () => void;
}

// ---------------------------------------------------------------------------
// BaseMap
// ---------------------------------------------------------------------------

export default function BaseMap({
  points,
  height = "100%",
  mapStyle = "mapbox://styles/mapbox/streets-v12",
  scrollWheelZoom = false,
  selectedIds,
  onToggle,
  route,
  onAllTilesLoaded,
}: BaseMapProps) {
  const [popupPoint, setPopupPoint] = useState<PilgrimagePoint | null>(null);

  const validPoints = useMemo(
    () => points.filter((p) => p.latitude && p.longitude),
    [points],
  );

  // Initial viewport — fit all points
  const initialViewState = useMemo(() => {
    if (validPoints.length === 0) {
      return { latitude: 35.6895, longitude: 139.6917, zoom: 12 };
    }
    if (validPoints.length === 1) {
      return { latitude: validPoints[0].latitude, longitude: validPoints[0].longitude, zoom: 14 };
    }
    // Calculate bounds center and approximate zoom
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of validPoints) {
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
      if (p.longitude < minLng) minLng = p.longitude;
      if (p.longitude > maxLng) maxLng = p.longitude;
    }
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    const span = Math.max(latSpan, lngSpan);
    // Rough zoom estimate based on span
    const zoom = span > 1 ? 8 : span > 0.5 ? 10 : span > 0.1 ? 12 : span > 0.01 ? 14 : 15;
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      zoom,
    };
  }, [validPoints]);

  const isRouteMode = !!route;

  // Route GeoJSON line
  const routeGeoJSON = useMemo(() => {
    if (!route) return null;
    const coords = route
      .filter((p) => p.latitude && p.longitude)
      .map((p) => [p.longitude, p.latitude]); // GeoJSON is [lng, lat]
    if (coords.length < 2) return null;
    return {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: coords },
    };
  }, [route]);

  const handleLoad = useCallback(
    (evt: { target: MapRef["getMap"] extends () => infer R ? R : never }) => {
      // Fit bounds on load
      if (validPoints.length > 1) {
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (const p of validPoints) {
          if (p.latitude < minLat) minLat = p.latitude;
          if (p.latitude > maxLat) maxLat = p.latitude;
          if (p.longitude < minLng) minLng = p.longitude;
          if (p.longitude > maxLng) maxLng = p.longitude;
        }
        evt.target.fitBounds(
          [[minLng, minLat], [maxLng, maxLat]],
          { padding: 50, duration: 0 },
        );
      }
      if (onAllTilesLoaded) {
        evt.target.once("idle", onAllTilesLoaded);
      }
    },
    [validPoints, onAllTilesLoaded],
  );

  const handleMarkerClick = useCallback(
    (point: PilgrimagePoint) => {
      setPopupPoint(point);
      onToggle?.(point.id);
    },
    [onToggle],
  );

  return (
    <Map
      initialViewState={initialViewState}
      style={{ width: "100%", height }}
      mapStyle={mapStyle}
      mapboxAccessToken={MAPBOX_TOKEN}
      scrollZoom={scrollWheelZoom || isRouteMode}
      onLoad={handleLoad}
      reuseMaps
    >
      <NavigationControl position="top-right" showCompass={false} />

      {/* Markers */}
      {validPoints.map((point, idx) => {
        const isSelected = selectedIds?.has(point.id) ?? false;
        return (
          <Marker
            key={point.id}
            latitude={point.latitude}
            longitude={point.longitude}
            anchor="center"
            onClick={(e) => { e.originalEvent.stopPropagation(); handleMarkerClick(point); }}
          >
            {isRouteMode ? (
              <div
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: isSelected ? "oklch(58% 0.19 28)" : "oklch(60% 0.148 240)",
                  color: "white", fontWeight: 600, fontSize: 14,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.3)", border: "2px solid white",
                  cursor: "pointer",
                }}
              >
                {idx + 1}
              </div>
            ) : (
              <svg
                width={isSelected ? 28 : 24}
                height={isSelected ? 40 : 36}
                viewBox="0 0 24 36"
                style={{ cursor: "pointer", transform: `translate(-50%, -100%)` }}
              >
                <path
                  d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z"
                  fill={isSelected ? "oklch(58% 0.19 28)" : "oklch(60% 0.148 240)"}
                />
                <circle cx="12" cy="12" r="5" fill="white" />
              </svg>
            )}
          </Marker>
        );
      })}

      {/* Popup */}
      {popupPoint && (
        <Popup
          latitude={popupPoint.latitude}
          longitude={popupPoint.longitude}
          anchor="bottom"
          onClose={() => setPopupPoint(null)}
          closeOnClick={false}
          offset={isRouteMode ? 16 : 36}
        >
          <div style={{ padding: "4px 2px", fontFamily: "var(--app-font-body)" }}>
            <strong style={{ fontSize: 13 }}>
              {isRouteMode && route ? `${route.findIndex((p) => p.id === popupPoint.id) + 1}. ` : ""}
              {popupPoint.name_cn || popupPoint.name}
            </strong>
            <br />
            <span style={{ fontSize: 12, color: "#666" }}>
              {popupPoint.title_cn || popupPoint.title}
              {popupPoint.episode != null ? ` · 第${popupPoint.episode}話` : ""}
            </span>
          </div>
        </Popup>
      )}

      {/* Route polyline */}
      {routeGeoJSON && (
        <Source type="geojson" data={routeGeoJSON}>
          <Layer
            type="line"
            paint={{
              "line-color": "oklch(58% 0.19 28)",
              "line-width": 3,
              "line-opacity": 0.8,
            }}
          />
        </Source>
      )}
    </Map>
  );
}
