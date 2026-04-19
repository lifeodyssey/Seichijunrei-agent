"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type {
  RouteData,
  TimedItinerary,
  TimedStop,
  TransitLeg,
} from "../../lib/types";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { Drawer } from "vaul";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const PilgrimageMap = dynamic(() => import("../map/PilgrimageMap"), {
  ssr: false,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLeg(
  legs: TransitLeg[],
  fromStop: TimedStop,
  toStop: TimedStop,
): TransitLeg | undefined {
  return legs.find(
    (l) => l.from_id === fromStop.cluster_id && l.to_id === toStop.cluster_id,
  );
}

function handleExportGoogleMaps(itinerary: TimedItinerary) {
  const urls = itinerary.export_google_maps_url;
  if (urls.length > 0) window.open(urls[0], "_blank");
}

function handleExportIcs(itinerary: TimedItinerary) {
  const icsContent = itinerary.export_ics;
  if (!icsContent) return;
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "seichijunrei.ics";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TimelineSidebar({
  itinerary,
}: {
  itinerary: TimedItinerary;
}) {
  const { stops, legs, spot_count, total_minutes, total_distance_m } =
    itinerary;

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-bg)]">
      <h3 className="shrink-0 px-4 py-3 text-xs font-semibold tracking-wide text-[var(--color-muted-fg)] font-[family-name:var(--app-font-display)]">
        タイムライン
      </h3>

      <ScrollArea className="flex-1 px-4">
        <ol className="relative pb-4">
          {stops.map((stop, idx) => {
            const nextStop = idx < stops.length - 1 ? stops[idx + 1] : null;
            const leg = nextStop ? findLeg(legs, stop, nextStop) : null;

            return (
              <li key={stop.cluster_id} className="relative">
                {/* Stop entry */}
                <div className="flex items-start gap-2 py-1.5">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[11px] font-bold text-white">
                    {idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] tabular-nums text-[var(--color-muted-fg)]">
                      {stop.arrive}
                    </span>
                    <p className="truncate text-sm font-medium text-[var(--color-fg)]">
                      {stop.name}
                    </p>
                    <p className="text-[10px] text-[var(--color-muted-fg)]">
                      {stop.photo_count} scenes · 滞在 {stop.dwell_minutes}min
                    </p>
                  </div>
                </div>

                {/* Connecting line + transit leg */}
                {leg && (
                  <div className="flex items-start gap-2 py-1">
                    <div className="flex w-6 shrink-0 justify-center">
                      <div className="h-6 w-px bg-[var(--color-border)]" />
                    </div>
                    <span className="rounded bg-[var(--color-muted)] px-2 py-0.5 text-[10px] text-[var(--color-muted-fg)]">
                      🚶 {leg.duration_minutes}min
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/* Summary */}
        <div className="border-t border-[var(--color-border)] pt-3 pb-4">
          <p className="text-[11px] font-semibold tracking-wide text-[var(--color-muted-fg)] font-[family-name:var(--app-font-display)]">
            サマリー
          </p>
          <dl className="mt-1 space-y-0.5 text-[11px] text-[var(--color-fg)]">
            <div className="flex justify-between">
              <dt>スポット</dt>
              <dd>{spot_count}</dd>
            </div>
            <div className="flex justify-between">
              <dt>所要時間</dt>
              <dd>{total_minutes}min</dd>
            </div>
            <div className="flex justify-between">
              <dt>移動距離</dt>
              <dd>{(total_distance_m / 1000).toFixed(1)} km</dd>
            </div>
          </dl>
        </div>
      </ScrollArea>

      {/* Export buttons at bottom of timeline sidebar */}
      <div className="shrink-0 flex gap-2 px-4 py-3 border-t border-[var(--color-border)]">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => handleExportGoogleMaps(itinerary)}
        >
          📍 Google Maps
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => handleExportIcs(itinerary)}
        >
          📅 Calendar
        </Button>
      </div>
    </div>
  );
}

function FallbackList({ data }: { data: RouteData }) {
  const points = data.route.ordered_points;
  return (
    <div className="flex-1 overflow-auto p-4">
      <ol className="space-y-2">
        {points.map((pt, idx) => (
          <li
            key={pt.id}
            className="flex items-center gap-2 text-sm text-[var(--color-fg)]"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[10px] font-bold text-white">
              {idx + 1}
            </span>
            <span className="truncate">{pt.name_cn || pt.name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface RoutePlannerWizardProps {
  data: RouteData;
}

export default function RoutePlannerWizard({ data }: RoutePlannerWizardProps) {
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const [, setPacing] = useState<"chill" | "normal" | "packed">(
    data.route.timed_itinerary?.pacing ?? "normal",
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  const itinerary = data.route.timed_itinerary;
  const points = data.route.ordered_points;
  const animeTitle = points[0]?.title_cn || points[0]?.title || "";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ─────────────────────────────────────────────── */}
      <div
        className={`flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] ${isMobile ? "px-3 py-2" : "px-4 py-3"}`}
      >
        {animeTitle && (
          <h2 className="font-[family-name:var(--app-font-display)] text-base font-semibold text-[var(--color-fg)]">
            {animeTitle}
          </h2>
        )}

        <div className="flex-1" />

        {/* Pacing tabs */}
        <Tabs
          defaultValue="normal"
          onValueChange={(v: string | number | null) => {
            if (typeof v === "string") setPacing(v as "chill" | "normal" | "packed");
          }}
        >
          <TabsList className="h-7">
            <TabsTrigger value="chill" className="text-xs px-2">
              ゆっくり
            </TabsTrigger>
            <TabsTrigger value="normal" className="text-xs px-2">
              普通
            </TabsTrigger>
            <TabsTrigger value="packed" className="text-xs px-2">
              詰め込み
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Transport badge */}
        <Badge variant="secondary" className="text-xs">
          🚶 徒歩
        </Badge>

        {/* Spot count */}
        {itinerary && (
          <span className="text-xs text-[var(--color-muted-fg)]">
            {itinerary.spot_count} spots
          </span>
        )}
      </div>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map area — full width on mobile, flex-1 on desktop */}
        <div className="relative flex-1">
          <PilgrimageMap points={points} route={points} height="100%" />

          {/* Sheet trigger overlaid on map — mobile spot list */}
          {itinerary && (
            <Sheet>
              <SheetTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="absolute bottom-3 left-3 z-[500] bg-[var(--color-bg)]/90 backdrop-blur-sm"
                  />
                }
              >
                ≡ スポット
              </SheetTrigger>
              <SheetContent side="left">
                <SheetHeader>
                  <SheetTitle className="font-[family-name:var(--app-font-display)]">
                    スポット一覧
                  </SheetTitle>
                </SheetHeader>
                <ScrollArea className="flex-1 px-4">
                  <ul className="space-y-3 pb-4">
                    {itinerary.stops.map((stop) => (
                      <li key={stop.cluster_id}>
                        <p className="text-sm font-medium text-[var(--color-fg)]">
                          {stop.name}
                        </p>
                        <Badge variant="secondary" className="mt-0.5 text-[10px]">
                          {stop.photo_count} photos
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </SheetContent>
            </Sheet>
          )}
        </div>

        {/* Timeline sidebar — desktop only, wider for fullscreen */}
        {!isMobile && (
          itinerary ? (
            <TimelineSidebar itinerary={itinerary} />
          ) : (
            <FallbackList data={data} />
          )
        )}
      </div>

      {/* ── Mobile bottom-sheet (vaul Drawer) ───────────────────────── */}
      {isMobile && (
        <Drawer.Root
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          snapPoints={[0.4, 0.9]}
          fadeFromIndex={1}
        >
          {/* Persistent handle bar that always peeks at the bottom */}
          <Drawer.Trigger asChild>
            <button
              className="shrink-0 w-full flex items-center justify-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-card)] py-2 text-xs text-[var(--color-muted-fg)]"
              aria-label="タイムラインを開く"
            >
              <span className="font-medium text-[var(--color-fg)]">
                {itinerary ? `タイムライン · ${itinerary.spot_count}スポット` : "スポット一覧"}
              </span>
              <span className="opacity-50">▲</span>
            </button>
          </Drawer.Trigger>

          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
            <Drawer.Content
              className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-[var(--color-card)] border-t border-[var(--color-border)] max-h-[90vh] outline-none"
              aria-label="タイムライン"
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <div className="w-10 h-1 rounded-full bg-[var(--color-muted-fg)] opacity-40" />
              </div>

              {/* Timeline content */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {itinerary ? (
                  <>
                    <h3 className="px-4 py-2 text-xs font-semibold tracking-wide text-[var(--color-muted-fg)] font-[family-name:var(--app-font-display)]">
                      タイムライン
                    </h3>
                    <ol className="relative px-4 pb-2">
                      {itinerary.stops.map((stop, idx) => {
                        const nextStop =
                          idx < itinerary.stops.length - 1
                            ? itinerary.stops[idx + 1]
                            : null;
                        const leg = nextStop
                          ? findLeg(itinerary.legs, stop, nextStop)
                          : null;

                        return (
                          <li key={stop.cluster_id} className="relative">
                            <div className="flex items-start gap-2 py-1.5">
                              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[11px] font-bold text-white">
                                {idx + 1}
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="text-[11px] tabular-nums text-[var(--color-muted-fg)]">
                                  {stop.arrive}
                                </span>
                                <p className="truncate text-sm font-medium text-[var(--color-fg)]">
                                  {stop.name}
                                </p>
                                <p className="text-[10px] text-[var(--color-muted-fg)]">
                                  {stop.photo_count} scenes · 滞在 {stop.dwell_minutes}min
                                </p>
                              </div>
                            </div>
                            {leg && (
                              <div className="flex items-start gap-2 py-1">
                                <div className="flex w-6 shrink-0 justify-center">
                                  <div className="h-6 w-px bg-[var(--color-border)]" />
                                </div>
                                <span className="rounded bg-[var(--color-muted)] px-2 py-0.5 text-[10px] text-[var(--color-muted-fg)]">
                                  🚶 {leg.duration_minutes}min
                                </span>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>

                    {/* Summary */}
                    <div className="mx-4 border-t border-[var(--color-border)] pt-3 pb-2">
                      <dl className="space-y-0.5 text-[11px] text-[var(--color-fg)]">
                        <div className="flex justify-between">
                          <dt className="text-[var(--color-muted-fg)]">スポット</dt>
                          <dd>{itinerary.spot_count}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-[var(--color-muted-fg)]">所要時間</dt>
                          <dd>{itinerary.total_minutes}min</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-[var(--color-muted-fg)]">移動距離</dt>
                          <dd>{(itinerary.total_distance_m / 1000).toFixed(1)} km</dd>
                        </div>
                      </dl>
                    </div>
                  </>
                ) : (
                  <FallbackList data={data} />
                )}
              </div>

              {/* Export buttons pinned at the bottom of the drawer */}
              {itinerary && (
                <div className="shrink-0 flex gap-2 px-4 py-3 border-t border-[var(--color-border)]">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleExportGoogleMaps(itinerary)}
                  >
                    📍 Maps
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleExportIcs(itinerary)}
                  >
                    📅 Cal
                  </Button>
                </div>
              )}
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}
    </div>
  );
}
