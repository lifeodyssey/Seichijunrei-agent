"use client";

import { useState } from "react";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";
import { useRouteExport } from "../../hooks/useRouteExport";
import type { RouteData, TimedItinerary } from "../../lib/types";
import RouteTimeline from "./RouteTimeline";
import FallbackList from "./FallbackList";

const EMPTY_ITINERARY: TimedItinerary = {
  stops: [],
  legs: [],
  total_minutes: 0,
  total_distance_m: 0,
  spot_count: 0,
  pacing: "normal",
  start_time: "",
  export_google_maps_url: [],
  export_ics: "",
};

interface MobileTimelineDrawerProps {
  itinerary: TimedItinerary | undefined;
  data: RouteData;
}

export default function MobileTimelineDrawer({ itinerary, data }: MobileTimelineDrawerProps) {
  const [open, setOpen] = useState(false);
  const { exportGoogleMaps, exportIcs } = useRouteExport(itinerary ?? EMPTY_ITINERARY);

  return (
    <Drawer.Root open={open} onOpenChange={setOpen} snapPoints={[0.4, 0.9]} fadeFromIndex={1}>
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
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-[var(--color-muted-fg)] opacity-40" />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {itinerary ? (
              <>
                <h3 className="px-4 py-2 text-xs font-semibold tracking-wide text-[var(--color-muted-fg)] font-[family-name:var(--app-font-display)]">
                  タイムライン
                </h3>
                <RouteTimeline itinerary={itinerary} />
              </>
            ) : (
              <FallbackList data={data} />
            )}
          </div>
          {itinerary && (
            <div className="shrink-0 flex gap-2 px-4 py-3 border-t border-[var(--color-border)]">
              <Button variant="outline" size="sm" className="flex-1" onClick={exportGoogleMaps}>
                📍 Maps
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={exportIcs}>
                📅 Cal
              </Button>
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
