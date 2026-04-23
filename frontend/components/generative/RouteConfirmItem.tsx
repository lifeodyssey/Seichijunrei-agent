"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PilgrimagePoint } from "../../lib/types";

// ---------------------------------------------------------------------------
// Drag handle — 2×3 grid of small dots
// ---------------------------------------------------------------------------

export function DragGrip() {
  return (
    <div
      className="flex shrink-0 cursor-grab flex-col gap-[3px] transition-opacity duration-150"
      style={{ color: "oklch(60% 0.148 240 / 0.25)" }}
      aria-hidden
    >
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-[3px]">
          <div className="h-[3px] w-[3px] rounded-full bg-current" />
          <div className="h-[3px] w-[3px] rounded-full bg-current" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable item
// ---------------------------------------------------------------------------

export interface SortableItemProps {
  point: PilgrimagePoint;
  index: number;
  onRemove: (id: string) => void;
}

export function SortableItem({ point, index, onRemove }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: point.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.9 : 1,
    boxShadow: isDragging ? "0 4px 16px rgba(0,0,0,0.12)" : "none",
    zIndex: isDragging ? 10 : "auto" as const,
  };

  const displayName = point.name_cn ?? point.name;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-3 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2.5"
    >
      {/* Drag handle — Fix 8: always-visible grip, animated on hover */}
      <button
        type="button"
        className="grip-handle flex h-[44px] w-[44px] shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <DragGrip />
      </button>

      {/* Thumbnail */}
      {point.screenshot_url && (
        <img
          src={point.screenshot_url}
          alt=""
          className="h-9 w-12 shrink-0 rounded-[var(--r-sm)] object-cover"
          loading="lazy"
        />
      )}

      {/* Index + name + episode */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className="shrink-0 text-sm text-[var(--color-muted-fg)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {index + 1}.
        </span>
        <span
          className="truncate text-sm text-[var(--color-fg)]"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {displayName}
        </span>
        {point.episode != null && (
          <span className="shrink-0 rounded-[var(--r-sm)] bg-[var(--color-muted)] px-1.5 py-0.5 text-[11px] text-[var(--color-muted-fg)]">
            EP {point.episode}
          </span>
        )}
      </div>

      {/* Remove button — visible on hover */}
      <button
        type="button"
        onClick={() => onRemove(point.id)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-[var(--color-muted-fg)] opacity-0 transition-opacity hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)] group-hover:opacity-100"
        aria-label={`移除 ${displayName}`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
