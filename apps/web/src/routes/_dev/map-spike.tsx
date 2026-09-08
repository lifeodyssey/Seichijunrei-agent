import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { MapSpike, type MapStatus } from "../../features/map-spike/MapSpike";
import { attachMapSpike } from "../../features/map-spike/map-controller";
import type { SourceMode } from "../../features/map-spike/source-mode";

// The `?source=` toggle is validated by the router (SSR-safe) instead of
// reading `window.location.search` in a state initializer.
const parseSearch = (search: Record<string, unknown>): { readonly source: SourceMode } => ({
  source: search.source === "worker" ? "worker" : "pmtiles",
});

export const Route = createFileRoute("/_dev/map-spike")({
  validateSearch: parseSearch,
  component: MapSpikeRoute,
});

type StatusSetter = (status: MapStatus) => void;

const attachToContainer = (container: HTMLDivElement | null, mode: SourceMode, onStatus: StatusSetter): (() => void) | undefined => {
  if (!container) {
    return undefined;
  }
  return attachMapSpike({ container, mode, onStatus });
};

function useMapSpikeMount(ref: RefObject<HTMLDivElement | null>, mode: SourceMode, onStatus: StatusSetter): void {
  useEffect(() => attachToContainer(ref.current, mode, onStatus), [ref, mode, onStatus]);
}

function MapSpikeRoute() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<MapStatus>("loading");
  const { source } = Route.useSearch();
  useMapSpikeMount(containerRef, source, setStatus);
  return <MapSpike mapContainerRef={containerRef} status={status} sourceMode={source} />;
}
