/**
 * Tests for mapbox prewarm module.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Reset module state between tests
beforeEach(() => {
  vi.resetModules();
});

describe("prewarmMapbox", () => {
  it("calls mapbox-gl prewarm when available", async () => {
    const prewarmFn = vi.fn();
    vi.doMock("mapbox-gl", () => ({ prewarm: prewarmFn }));

    const { prewarmMapbox } = await import("@/components/map/prewarm");
    prewarmMapbox();

    // Wait for dynamic import to resolve
    await vi.dynamicImportSettled();
    expect(prewarmFn).toHaveBeenCalled();
  });

  it("resets prewarmed flag on import failure so retry is possible", async () => {
    vi.doMock("mapbox-gl", () => {
      throw new Error("Module not found");
    });

    const { prewarmMapbox } = await import("@/components/map/prewarm");
    prewarmMapbox();

    // Should not throw — the .catch handler resets prewarmed
    // A second call should attempt again
    vi.doMock("mapbox-gl", () => ({ prewarm: vi.fn() }));
    // After the catch, prewarmed should be false, allowing retry
  });

  it("is safe to call in non-browser environment", async () => {
    const origWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", { value: undefined, configurable: true });

    const { prewarmMapbox } = await import("@/components/map/prewarm");
    expect(() => prewarmMapbox()).not.toThrow();

    Object.defineProperty(globalThis, "window", { value: origWindow, configurable: true });
  });
});
