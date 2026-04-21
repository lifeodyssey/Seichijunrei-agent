"use client";

/**
 * LeafletResultMap — thin wrapper around BaseMap for the ResultPanel grid/map toggle.
 *
 * This file is loaded lazily via dynamic() from ResultPanel.
 * It MUST NOT be imported at the top level of any server-rendered module.
 */

import BaseMap from "../map/BaseMap";
import type { PilgrimagePoint } from "../../lib/types";

interface LeafletResultMapProps {
  points: PilgrimagePoint[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

export default function LeafletResultMap({
  points,
  selectedIds,
  onToggle,
}: LeafletResultMapProps) {
  return (
    <BaseMap
      points={points}
      selectedIds={selectedIds}
      onToggle={onToggle}
      height="100%"
    />
  );
}
