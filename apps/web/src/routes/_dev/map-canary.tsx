import type { StyleSpecification } from "maplibre-gl";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { attachMapLibre } from "../../features/maplibre/maplibre-adapter";

type CanaryMode = "fallback" | "happy";
type CanaryStatus = "fallback" | "loading" | "ready" | "unmounted";

// The `?mode=fallback` failure toggle is validated by the router (SSR-safe)
// instead of reading `window.location.search` in a state initializer.
const parseSearch = (search: Record<string, unknown>): { readonly mode: CanaryMode } => ({
  mode: search.mode === "fallback" ? "fallback" : "happy",
});

export const Route = createFileRoute("/_dev/map-canary")({
  validateSearch: parseSearch,
  component: MapCanaryRoute,
});

const canaryStyle = (): StyleSpecification => ({
  version: 8,
  name: "animichi-maplibre-canary",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f8f8f0" } }],
});

type SetCanaryStatus = (status: CanaryStatus) => void;

const canaryOptions = (container: HTMLDivElement, mode: CanaryMode, setStatus: SetCanaryStatus) => ({
  container,
  interactive: false,
  onError: () => { setStatus("fallback"); },
  onLoad: mode === "fallback" ? () => { throw new Error("canary setup failure"); } : undefined,
  onReady: () => { setStatus("ready"); },
  style: canaryStyle(),
});

function useCanaryMount(containerRef: RefObject<HTMLDivElement | null>, mode: CanaryMode, mounted: boolean, setStatus: SetCanaryStatus): void {
  useEffect(() => {
    if (!mounted || !containerRef.current) {
      setStatus("unmounted");
      return undefined;
    }
    setStatus("loading");
    return attachMapLibre(canaryOptions(containerRef.current, mode, setStatus));
  }, [containerRef, mode, mounted, setStatus]);
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
    <main aria-label="MapLibre v5 canary" data-mode={mode} data-status={status}>
      <h1>MapLibre v5 canary</h1>
      <p role="status" aria-live="polite">Status: {status}</p>
      <UnmountButton mounted={mounted} onUnmount={onUnmount} />
      <CanaryContainer containerRef={containerRef} />
    </main>
  );
}

function MapCanaryRoute() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mode } = Route.useSearch();
  const [mounted, setMounted] = useState(true);
  const [status, setStatus] = useState<CanaryStatus>("loading");
  const handleUnmount = (): void => { setMounted(false); };
  useCanaryMount(containerRef, mode, mounted, setStatus);
  return <CanaryView containerRef={containerRef} mode={mode} mounted={mounted} onUnmount={handleUnmount} status={status} />;
}
