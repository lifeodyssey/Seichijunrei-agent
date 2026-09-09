import type { StyleSpecification } from "maplibre-gl";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { attachMapLibre } from "../../features/maplibre/maplibre-adapter";
import type { MapLibreMountContext } from "../../features/maplibre/maplibre-adapter";

type CanaryMode = "fallback" | "happy";
type CanaryStatus = "fallback" | "loading" | "ready" | "sourced" | "unmounted";

const CANARY_SOURCE = "canary-points";

// The `?mode=fallback` failure toggle is validated by the router (SSR-safe)
// instead of reading `window.location.search` in a state initializer.
const parseSearch = (search: Record<string, unknown>): { readonly mode: CanaryMode } => ({
  mode: search.mode === "fallback" ? "fallback" : "happy",
});

export const Route = createFileRoute("/_dev/map-canary")({
  validateSearch: parseSearch,
  component: MapCanaryRoute,
});

// A geojson source is parsed in the tile worker, so `isSourceLoaded` only turns
// true once that worker is reachable. A background-only style never touches the
// worker, which is how a 404 worker URL previously passed this canary.
const canarySources = (): StyleSpecification["sources"] => ({
  [CANARY_SOURCE]: {
    type: "geojson",
    data: { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [135.8074, 34.8914] } }] },
  },
});

const canaryLayers = (): StyleSpecification["layers"] => [
  { id: "background", type: "background", paint: { "background-color": "#f8f8f0" } },
  { id: "canary-dot", type: "circle", source: CANARY_SOURCE, paint: { "circle-radius": 6 } },
];

const canaryStyle = (): StyleSpecification => ({
  version: 8,
  name: "animichi-maplibre-canary",
  sources: canarySources(),
  layers: canaryLayers(),
});

type SetCanaryStatus = (status: CanaryStatus) => void;

type CanaryCallbacks = Readonly<{
  setSourceLoaded: (loaded: boolean) => void;
  setStatus: SetCanaryStatus;
}>;

const watchCanarySource = (context: MapLibreMountContext, setSourceLoaded: (loaded: boolean) => void): (() => void) => {
  const settle = (): void => { setSourceLoaded(context.map.isSourceLoaded(CANARY_SOURCE)); };
  context.map.on("sourcedata", settle);
  settle();
  return () => { context.map.off("sourcedata", settle); };
};

const canaryOptions = (container: HTMLDivElement, mode: CanaryMode, callbacks: CanaryCallbacks) => ({
  container,
  interactive: false,
  onError: () => { callbacks.setStatus("fallback"); },
  onLoad: mode === "fallback"
    ? () => { throw new Error("canary setup failure"); }
    : (context: MapLibreMountContext) => watchCanarySource(context, callbacks.setSourceLoaded),
  onReady: () => { callbacks.setStatus("ready"); },
  style: canaryStyle(),
});

function useCanaryMount(containerRef: RefObject<HTMLDivElement | null>, mode: CanaryMode, mounted: boolean, callbacks: CanaryCallbacks): void {
  useEffect(() => {
    if (!mounted || !containerRef.current) {
      callbacks.setStatus("unmounted");
      return undefined;
    }
    callbacks.setStatus("loading");
    return attachMapLibre(canaryOptions(containerRef.current, mode, callbacks));
  }, [containerRef, mode, mounted, callbacks]);
}

const UnmountButton = ({ mounted, onUnmount }: Readonly<{ mounted: boolean; onUnmount: () => void }>) => {
  return <button type="button" disabled={!mounted} onClick={onUnmount}>Unmount map</button>;
};

const CanaryContainer = ({ containerRef }: Readonly<{ containerRef: RefObject<HTMLDivElement | null> }>) => {
  return <div ref={containerRef} />;
};

interface CanaryViewProps {
  containerRef: RefObject<HTMLDivElement | null>;
  mode: CanaryMode;
  mounted: boolean;
  onUnmount: () => void;
  status: CanaryStatus;
}

function CanaryView({ containerRef, mode, mounted, onUnmount, status }: CanaryViewProps) {
  return (
    <main aria-label="MapLibre canary" data-mode={mode} data-status={status}>
      <h1>MapLibre canary</h1>
      <p role="status" aria-live="polite">Status: {status}</p>
      <UnmountButton mounted={mounted} onUnmount={onUnmount} />
      <CanaryContainer containerRef={containerRef} />
    </main>
  );
}

// `sourced` outranks `ready`: the map reports load before its source finishes,
// so the two facts are tracked apart and folded only for display.
const useCanaryStatus = (): Readonly<{ callbacks: CanaryCallbacks; shown: CanaryStatus }> => {
  const [status, setStatus] = useState<CanaryStatus>("loading");
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const callbacks = useMemo<CanaryCallbacks>(() => ({ setSourceLoaded, setStatus }), []);
  return { callbacks, shown: status === "ready" && sourceLoaded ? "sourced" : status };
};

function MapCanaryRoute() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mode } = Route.useSearch();
  const [mounted, setMounted] = useState(true);
  const { callbacks, shown } = useCanaryStatus();
  const handleUnmount = (): void => { setMounted(false); };
  useCanaryMount(containerRef, mode, mounted, callbacks);
  return <CanaryView containerRef={containerRef} mode={mode} mounted={mounted} onUnmount={handleUnmount} status={shown} />;
}
