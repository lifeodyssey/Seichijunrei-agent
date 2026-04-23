"use client";

import { useCallback } from "react";
import type { TimedItinerary } from "../lib/types";
import { isSafeUrl } from "../lib/url";

interface RouteExportHandlers {
  exportGoogleMaps: () => void;
  exportIcs: () => void;
}

export function useRouteExport(itinerary: TimedItinerary): RouteExportHandlers {
  const exportGoogleMaps = useCallback(() => {
    const urls = itinerary.export_google_maps_url;
    const url = urls[0];
    if (isSafeUrl(url)) window.open(url, "_blank", "noopener,noreferrer");
  }, [itinerary.export_google_maps_url]);

  const exportIcs = useCallback(() => {
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
  }, [itinerary.export_ics]);

  return { exportGoogleMaps, exportIcs };
}
