"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { haversineKm } from "../../lib/geo";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RouteConfirmProps {
  points: PilgrimagePoint[];
  defaultOrigin: string;
  onConfirm: (orderedIds: string[], origin: string) => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Drag handle — 2×3 grid of small dots
// ---------------------------------------------------------------------------

function DragGrip() {
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

interface SortableItemProps {
  point: PilgrimagePoint;
  index: number;
  onRemove: (id: string) => void;
}

function SortableItem({ point, index, onRemove }: SortableItemProps) {
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
        className="grip-handle flex h-[44px] w-5 shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
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

// ---------------------------------------------------------------------------
// RouteConfirm
// ---------------------------------------------------------------------------

export default function RouteConfirm({
  points,
  defaultOrigin,
  onConfirm,
  onBack,
}: RouteConfirmProps) {
  const { route_confirm: t } = useDict();
  const [orderedPoints, setOrderedPoints] = useState<PilgrimagePoint[]>(points);
  const [origin, setOrigin] = useState(defaultOrigin);
  const [lastRemoved, setLastRemoved] = useState<{ point: PilgrimagePoint; index: number } | null>(null);

  useEffect(() => {
    if (!lastRemoved) return;
    const timer = setTimeout(() => setLastRemoved(null), 5000);
    return () => clearTimeout(timer);
  }, [lastRemoved]);

  const canConfirm = orderedPoints.length >= 2;

  const totalDistanceKm = useMemo(() => {
    let total = 0;
    for (let i = 1; i < orderedPoints.length; i++) {
      total += haversineKm(
        orderedPoints[i - 1].latitude,
        orderedPoints[i - 1].longitude,
        orderedPoints[i].latitude,
        orderedPoints[i].longitude,
      );
    }
    return total;
  }, [orderedPoints]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrderedPoints((prev) => {
      const oldIndex = prev.findIndex((p) => p.id === active.id);
      const newIndex = prev.findIndex((p) => p.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const handleRemove = useCallback((id: string) => {
    setOrderedPoints((prev) => {
      const index = prev.findIndex((p) => p.id === id);
      if (index === -1) return prev;
      setLastRemoved({ point: prev[index], index });
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    onConfirm(
      orderedPoints.map((p) => p.id),
      origin,
    );
  }, [canConfirm, onConfirm, orderedPoints, origin]);

  const itemIds = useMemo(
    () => orderedPoints.map((p) => p.id),
    [orderedPoints],
  );

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg)]">
      {/* Fix 8: grip hover animation */}
      <style>{`
        .group:hover .grip-handle > div { color: oklch(60% 0.148 240 / 0.6) !important; }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center border-b border-[var(--color-border)] px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-[44px] items-center gap-1 text-sm text-[var(--color-muted-fg)] transition-colors hover:text-[var(--color-fg)]"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t.back}
        </button>
        <span
          className="flex-1 text-center text-base font-semibold text-[var(--color-fg)]"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {t.title}
        </span>
        {/* Spacer for centering */}
        <div className="w-[72px]" />
      </div>

      {/* ── Departure input ─────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
        <label className="mb-1 block text-xs text-[var(--color-muted-fg)]">
          {t.departure_label}
        </label>
        <input
          type="text"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder={t.departure_placeholder}
          className="h-[44px] w-full rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm text-[var(--color-fg)] outline-none transition-colors placeholder:text-[var(--color-muted-fg)] focus:border-[var(--color-primary)]"
        />
      </div>

      {/* ── Sortable list ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={itemIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-2">
              {orderedPoints.map((point, index) => (
                <SortableItem
                  key={point.id}
                  point={point}
                  index={index}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {orderedPoints.length === 0 && (
          <p className="py-8 text-center text-sm text-[var(--color-muted-fg)]">
            {t.empty}
          </p>
        )}
      </div>

      {/* ── Undo toast ───────────────────────────────────────────────── */}
      {lastRemoved && (
        <div className="shrink-0 px-4 pb-2">
          <div
            className="flex items-center justify-between rounded-[var(--r-md)] px-4 py-2"
            style={{ background: "var(--color-fg)", color: "var(--color-bg)", fontSize: 13 }}
          >
            <span>{t.removed.replace("{name}", lastRemoved.point.name_cn || lastRemoved.point.name)}</span>
            <button
              type="button"
              onClick={() => {
                setOrderedPoints(prev => {
                  const next = [...prev];
                  next.splice(lastRemoved.index, 0, lastRemoved.point);
                  return next;
                });
                setLastRemoved(null);
              }}
              style={{ fontWeight: 600, marginLeft: 12, color: "oklch(80% 0.12 240)" }}
            >
              {t.undo}
            </button>
          </div>
        </div>
      )}

      {/* ── Summary + confirm — Fix 9 & 10 ──────────────────────────── */}
      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-card)] px-4 py-4">
        <div className="mb-3 text-center">
          <div
            className="font-[family-name:var(--app-font-display)] text-[var(--color-fg)]"
            style={{ fontSize: 14 }}
          >
            {t.summary.replace("{count}", String(orderedPoints.length))}
          </div>
          <div
            className="mt-0.5 text-[var(--color-muted-fg)]"
            style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}
          >
            {t.estimate
              .replace("{distance}", totalDistanceKm.toFixed(1))
              .replace("{time}", String(Math.max(1, Math.round((totalDistanceKm / 4) * 60))))}
          </div>
        </div>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="flex h-[44px] w-full items-center justify-center gap-2 rounded-[var(--r-md)] bg-[var(--color-primary)] text-sm font-semibold text-[var(--color-primary-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
          </svg>
          {t.start}
        </button>
      </div>
    </div>
  );
}
