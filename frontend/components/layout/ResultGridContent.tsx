"use client";

import { useRef, useState, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PilgrimagePoint } from "../../lib/types";
import { PhotoCard } from "../generative/PhotoCard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GridContentProps {
  points: PilgrimagePoint[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onDetail?: (point: PilgrimagePoint) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIRTUAL_THRESHOLD = 50;
const COL_MIN_WIDTH = 200;
const ROW_HEIGHT = 220; // approx card height including gap
const GAP = 12;

// ---------------------------------------------------------------------------
// GridContent — flat grid for small sets, virtualized for large
// ---------------------------------------------------------------------------

export function GridContent({ points, selectedIds, onToggle, onDetail }: GridContentProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Below threshold, render flat grid (simpler, no jumpiness)
  if (points.length <= VIRTUAL_THRESHOLD) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${COL_MIN_WIDTH}px, 1fr))`,
            gap: `${GAP}px`,
          }}
        >
          {points.map((point) => (
            <PhotoCard
              key={point.id}
              point={point}
              selected={selectedIds.has(point.id)}
              onToggle={onToggle}
              onDetail={onDetail}
            />
          ))}
        </div>
      </div>
    );
  }

  return <VirtualGrid parentRef={parentRef} points={points} selectedIds={selectedIds} onToggle={onToggle} onDetail={onDetail} />;
}

// ---------------------------------------------------------------------------
// VirtualGrid — virtualized rows for large point sets
// ---------------------------------------------------------------------------

function VirtualGrid({
  parentRef,
  points,
  selectedIds,
  onToggle,
  onDetail,
}: GridContentProps & { parentRef: React.RefObject<HTMLDivElement | null> }) {
  const [cols, setCols] = useState(3);
  const rowCount = Math.ceil(points.length / cols);

  // Measure container width to compute columns
  const measureRef = useMemo(() => {
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 800;
      setCols(Math.max(1, Math.floor(w / (COL_MIN_WIDTH + GAP))));
    });
    return (el: HTMLDivElement | null) => {
      if (el) ro.observe(el);
      // assign to parent ref for virtualizer
      (parentRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    };
  }, [parentRef]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
  });

  return (
    <div ref={measureRef} className="flex-1 overflow-y-auto p-4">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const start = vRow.index * cols;
          const rowPoints = points.slice(start, start + cols);
          return (
            <div
              key={vRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vRow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap: `${GAP}px`,
              }}
            >
              {rowPoints.map((point) => (
                <PhotoCard
                  key={point.id}
                  point={point}
                  selected={selectedIds.has(point.id)}
                  onToggle={onToggle}
                  onDetail={onDetail}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
