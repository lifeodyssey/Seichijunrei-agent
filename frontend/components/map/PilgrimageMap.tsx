"use client";

/**
 * PilgrimageMap — thin wrapper around BaseMap for route/nearby views.
 *
 * Preserves the existing API so NearbyMap and route components
 * don't need changes.
 */

import BaseMap from "./BaseMap";
import type { PilgrimagePoint } from "../../lib/types";

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
  scrollWheelZoom,
}: PilgrimageMapProps) {
  return (
    <BaseMap
      points={points}
      route={route}
      height={height}
      scrollWheelZoom={scrollWheelZoom ?? !!route}
    />
  );
}
