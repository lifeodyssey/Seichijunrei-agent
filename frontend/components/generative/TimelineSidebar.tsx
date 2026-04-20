"use client";

import { Button } from "@/components/ui/button";
import { useRouteExport } from "../../hooks/useRouteExport";
import type { TimedItinerary } from "../../lib/types";
import RouteTimeline from "./RouteTimeline";

interface TimelineSidebarProps {
  itinerary: TimedItinerary;
}

export default function TimelineSidebar({ itinerary }: TimelineSidebarProps) {
  const { exportGoogleMaps, exportIcs } = useRouteExport(itinerary);
  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-bg)]">
      <h3 className="shrink-0 px-4 py-3 text-xs font-semibold tracking-wide text-[var(--color-muted-fg)] font-[family-name:var(--app-font-display)]">
        タイムライン
      </h3>
      <RouteTimeline itinerary={itinerary} />
      <div className="shrink-0 flex gap-2 px-4 py-3 border-t border-[var(--color-border)]">
        <Button variant="outline" size="sm" className="flex-1" onClick={exportGoogleMaps}>
          📍 Google Maps
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={exportIcs}>
          📅 Calendar
        </Button>
      </div>
    </div>
  );
}
