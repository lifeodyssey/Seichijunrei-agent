/**
 * useRouteExport hook unit tests (TDD).
 *
 * AC coverage:
 * - exportGoogleMaps opens the first URL in export_google_maps_url in a new tab -> unit
 * - exportGoogleMaps does nothing when the URL list is empty -> unit
 * - exportIcs triggers a download of the ICS blob -> unit
 * - exportIcs does nothing when export_ics is empty -> unit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRouteExport } from "@/hooks/useRouteExport";
import type { TimedItinerary } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItinerary(overrides: Partial<TimedItinerary> = {}): TimedItinerary {
  return {
    stops: [],
    legs: [],
    total_minutes: 60,
    total_distance_m: 1000,
    spot_count: 2,
    pacing: "normal",
    start_time: "09:00",
    export_google_maps_url: ["https://maps.google.com/?q=test"],
    export_ics: "BEGIN:VCALENDAR\nEND:VCALENDAR",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useRouteExport", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  let createElementSpy: ReturnType<typeof vi.spyOn>;
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let mockAnchor: HTMLAnchorElement;

  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    mockAnchor = document.createElement("a");
    mockAnchor.click = vi.fn();

    const originalCreateElement = document.createElement.bind(document);
    createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName: string, ...args: unknown[]) => {
        if (tagName === "a") return mockAnchor;
        return originalCreateElement(tagName, ...(args as [ElementCreationOptions?]));
      });
    vi.spyOn(document.body, "appendChild");
    vi.spyOn(document.body, "removeChild");
    createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:fake-url");
    revokeObjectUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("exportGoogleMaps", () => {
    it("opens the first Google Maps URL in a new tab", () => {
      const { result } = renderHook(() => useRouteExport(makeItinerary()));
      act(() => result.current.exportGoogleMaps());
      expect(openSpy).toHaveBeenCalledWith(
        "https://maps.google.com/?q=test",
        "_blank",
        "noopener,noreferrer",
      );
    });

    it("does nothing when export_google_maps_url is empty", () => {
      const { result } = renderHook(() =>
        useRouteExport(makeItinerary({ export_google_maps_url: [] })),
      );
      act(() => result.current.exportGoogleMaps());
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe("exportIcs", () => {
    it("creates a download anchor and clicks it", () => {
      const { result } = renderHook(() => useRouteExport(makeItinerary()));
      act(() => result.current.exportIcs());
      const anchorCalls = createElementSpy.mock.calls.filter(([tag]: [string]) => tag === "a");
      expect(anchorCalls).toHaveLength(1);
      expect(mockAnchor.download).toBe("seichijunrei.ics");
      expect(mockAnchor.click).toHaveBeenCalled();
    });

    it("creates an object URL from the ICS blob", () => {
      const { result } = renderHook(() => useRouteExport(makeItinerary()));
      act(() => result.current.exportIcs());
      expect(createObjectUrlSpy).toHaveBeenCalled();
      expect(mockAnchor.href).toBe("blob:fake-url");
    });

    it("revokes the object URL after the click", () => {
      const { result } = renderHook(() => useRouteExport(makeItinerary()));
      act(() => result.current.exportIcs());
      expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:fake-url");
    });

    it("does nothing when export_ics is empty string", () => {
      const { result } = renderHook(() =>
        useRouteExport(makeItinerary({ export_ics: "" })),
      );
      act(() => result.current.exportIcs());
      // Should not create an <a> anchor element for downloading.
      const anchorCalls = createElementSpy.mock.calls.filter(([tag]: [string]) => tag === "a");
      expect(anchorCalls).toHaveLength(0);
    });
  });
});
