"use client";

import { useState, useMemo } from "react";
import type { SearchResultData, PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";
import { resolveUnknownName } from "../../lib/japanRegions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import SourceBadge from "./SourceBadge";

function PilgrimageCard({
  point,
  idx: _idx,
  episodeLabel,
  selected,
  onToggle,
}: {
  point: PilgrimagePoint;
  idx: number;
  episodeLabel: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const [imgError, setImgError] = useState(false);

  // Treat empty string as absent — same as null for rendering purposes.
  const hasImage = Boolean(point.screenshot_url) && !imgError;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`group relative overflow-hidden rounded-[var(--r-md)] border bg-[var(--color-muted)] text-left transition-all ${
        selected
          ? "border-[var(--color-primary)] shadow-sm"
          : "border-[var(--color-border)] hover:border-[var(--color-primary)] hover:-translate-y-0.5 hover:shadow-md"
      }`}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      {/* Selection checkmark */}
      {selected && (
        <span className="absolute right-1.5 top-1.5 z-10 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--color-primary)] text-[11px] font-bold text-white shadow-sm">
          ✓
        </span>
      )}

      {/* Image with dark overlay bar */}
      <div className="relative aspect-[4/3] overflow-hidden">
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={point.screenshot_url!}
            alt={point.name_cn || point.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[var(--color-muted)]">
            <span
              className="select-none font-[family-name:var(--app-font-display)] text-2xl"
              style={{ color: "color-mix(in oklch, var(--color-fg) 12%, transparent)" }}
            >
              聖
            </span>
          </div>
        )}

        {/* EP badge — top left */}
        <SourceBadge
          screenshotUrl={point.screenshot_url}
          episode={point.episode}
          episodeLabel={
            typeof point.episode === "number" && point.episode > 0
              ? episodeLabel.replace("{ep}", String(point.episode))
              : undefined
          }
        />

        {/* Dark overlay bar at bottom — name + EP on the image */}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-6">
          <span className="truncate text-xs font-medium text-white">
            {(point.name_cn && point.name_cn !== "不明" ? point.name_cn : null)
              || (point.name && point.name !== "不明" ? point.name : null)
              || resolveUnknownName(point.latitude, point.longitude)
              || point.name_cn
              || point.name}
          </span>
          {point.episode != null && point.episode > 0 && (
            <span className="ml-1 shrink-0 text-[11px] text-white/70">
              EP{point.episode}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function GroupSection({
  label,
  count,
  points,
  episodeLabel,
  selectedIds,
  toggle,
  defaultOpen = true,
}: {
  label: string;
  count: number;
  points: PilgrimagePoint[];
  episodeLabel: string;
  selectedIds: ReadonlySet<string>;
  toggle: (id: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-left"
      >
        <span className="text-[10px] text-[var(--color-muted-fg)] transition-transform" style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>
          ▶
        </span>
        <span className="text-xs font-medium text-[var(--color-fg)]">{label}</span>
        <Badge variant="secondary" className="text-[10px]">{count}</Badge>
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {points.map((point, idx) => (
            <PilgrimageCard
              key={point.id}
              point={point}
              idx={idx}
              episodeLabel={episodeLabel}
              selected={selectedIds.has(point.id)}
              onToggle={() => toggle(point.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface PilgrimageGridProps {
  data: SearchResultData;
}

export default function PilgrimageGrid({ data }: PilgrimageGridProps) {
  const { grid: t } = useDict();
  const { selectedIds, toggle } = usePointSelectionContext();
  const { results } = data;

  const episodeGroups = useMemo(() => {
    const groups = new Map<string, PilgrimagePoint[]>();
    for (const point of results.rows) {
      const key = point.episode != null && point.episode !== 0
        ? String(point.episode)
        : "__other__";
      const list = groups.get(key) ?? [];
      list.push(point);
      groups.set(key, list);
    }
    // Sort numeric keys, put "other" last
    const sorted: Array<[string, PilgrimagePoint[]]> = [];
    const keys = [...groups.keys()].filter((k) => k !== "__other__").sort((a, b) => Number(a) - Number(b));
    for (const k of keys) sorted.push([k, groups.get(k)!]);
    if (groups.has("__other__")) sorted.push(["__other__", groups.get("__other__")!]);
    return sorted;
  }, [results.rows]);

  const areaGroups = useMemo(() => {
    const groups = new Map<string, PilgrimagePoint[]>();
    for (const point of results.rows) {
      const key = point.origin ? point.origin : "__unknown__";
      const list = groups.get(key) ?? [];
      list.push(point);
      groups.set(key, list);
    }
    const sorted: Array<[string, PilgrimagePoint[]]> = [];
    const keys = [...groups.keys()].filter((k) => k !== "__unknown__").sort();
    for (const k of keys) sorted.push([k, groups.get(k)!]);
    if (groups.has("__unknown__")) sorted.push(["__unknown__", groups.get("__unknown__")!]);
    return sorted;
  }, [results.rows]);

  if (results.status === "empty" || results.rows.length === 0) {
    return (
      <div className="space-y-4">
        <div className="py-8 text-sm font-light text-[var(--color-muted-fg)]">
          {t.no_results}
        </div>
        <div className="grid grid-cols-2 gap-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[4/3]" />
          ))}
        </div>
      </div>
    );
  }

  const animeTitle = results.rows[0]?.title_cn || results.rows[0]?.title || "";

  return (
    <div className="space-y-5">
      {/* Editorial section header */}
      <div className="flex items-baseline gap-4">
        {animeTitle && (
          <h2 className="font-[family-name:var(--app-font-display)] text-lg font-semibold text-[var(--color-fg)]">
            {animeTitle}
          </h2>
        )}
        <span className="text-xs font-light text-[var(--color-muted-fg)]">
          {t.count.replace("{count}", String(results.row_count))}
        </span>
      </div>

      <Tabs defaultValue="episode">
        <TabsList variant="line">
          <TabsTrigger value="episode">{t.tab_episode}</TabsTrigger>
          <TabsTrigger value="area">{t.tab_area}</TabsTrigger>
        </TabsList>

        <TabsContent value="episode">
          <div className="space-y-4 pt-3">
            {episodeGroups.map(([key, points]) => (
              <GroupSection
                key={key}
                label={key === "__other__" ? (t.other_label) : `EP ${key}`}
                count={points.length}
                points={points}
                episodeLabel={t.episode}
                selectedIds={selectedIds}
                toggle={toggle}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="area">
          <div className="space-y-4 pt-3">
            {areaGroups.map(([key, points]) => (
              <GroupSection
                key={key}
                label={key === "__unknown__"
                  ? (resolveUnknownName(points[0].latitude, points[0].longitude) ?? t.unknown_area)
                  : key}
                count={points.length}
                points={points}
                episodeLabel={t.episode}
                selectedIds={selectedIds}
                toggle={toggle}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Selection bar is rendered by ResultPanel (bottom-fixed, visible in both grid + map) */}
    </div>
  );
}
