"use client";

import { useState, useRef, type FormEvent } from "react";
import type { Dict, Locale } from "../../lib/i18n";

type GeoState =
  | { kind: "idle" }
  | { kind: "acquiring" }
  | { kind: "denied" }
  | { kind: "timeout" }
  | { kind: "ok"; lat: number; lng: number };

interface LocationPromptProps {
  onCoords: (lat: number, lng: number) => void;
  onStation: (station: string) => void;
  onDismiss: () => void;
  dict: Dict;
  locale: Locale;
}

export default function LocationPrompt({
  onCoords,
  onStation,
  onDismiss,
  dict,
}: LocationPromptProps) {
  const t = dict.location;
  const [geoState, setGeoState] = useState<GeoState>({ kind: "idle" });
  const [showStationInput, setShowStationInput] = useState(false);
  const [stationValue, setStationValue] = useState("");
  const stationInputRef = useRef<HTMLInputElement>(null);

  function handleUseCurrentLocation() {
    setGeoState({ kind: "acquiring" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setGeoState({ kind: "ok", lat, lng });
        onCoords(lat, lng);
      },
      (error) => {
        // error.code: 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        if (error.code === 3) {
          setGeoState({ kind: "timeout" });
        } else {
          setGeoState({ kind: "denied" });
        }
        setShowStationInput(true);
        setTimeout(() => stationInputRef.current?.focus(), 0);
      },
      { timeout: 10_000 },
    );
  }

  function handleEnterStation() {
    setShowStationInput(true);
    setTimeout(() => stationInputRef.current?.focus(), 0);
  }

  function handleStationSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = stationValue.trim();
    if (!value) return;
    onStation(value);
  }

  const isAcquiring = geoState.kind === "acquiring";

  return (
    <div
      className="mx-auto mb-2 flex max-w-[680px] flex-col gap-2 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-3 shadow-sm"
      role="region"
      aria-label="location prompt"
    >
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {!isAcquiring && geoState.kind !== "ok" && (
            <>
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-sm text-[var(--color-fg)] transition-colors hover:border-[var(--color-primary)]/50 hover:text-[var(--color-primary)]"
                style={{ transitionDuration: "var(--duration-fast)" }}
              >
                <span aria-hidden="true">📍</span>
                {t.use_current}
              </button>
              {!showStationInput && (
                <button
                  type="button"
                  onClick={handleEnterStation}
                  className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-sm text-[var(--color-fg)] transition-colors hover:border-[var(--color-primary)]/50 hover:text-[var(--color-primary)]"
                  style={{ transitionDuration: "var(--duration-fast)" }}
                >
                  {t.enter_station}
                </button>
              )}
            </>
          )}

          {isAcquiring && (
            <span className="text-sm text-[var(--color-muted-fg)]">
              {t.acquiring}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="dismiss location prompt"
          className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>

      {(geoState.kind === "denied" || geoState.kind === "timeout") && (
        <p className="text-xs text-[var(--color-muted-fg)]">
          {geoState.kind === "denied" ? t.denied : t.timeout}
        </p>
      )}

      {showStationInput && geoState.kind !== "acquiring" && (
        <form onSubmit={handleStationSubmit} className="flex gap-2">
          <input
            ref={stationInputRef}
            type="text"
            value={stationValue}
            onChange={(e) => setStationValue(e.target.value)}
            placeholder={t.enter_station}
            className="flex-1 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-primary)] placeholder:text-[var(--color-muted-fg)]"
          />
          <button
            type="submit"
            disabled={!stationValue.trim()}
            className="rounded-[var(--r-lg)] bg-[var(--color-primary)] px-3 py-1.5 text-sm text-[var(--color-primary-fg)] disabled:opacity-40"
          >
            OK
          </button>
        </form>
      )}
    </div>
  );
}
