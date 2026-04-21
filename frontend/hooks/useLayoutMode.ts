"use client";

import { useCallback, useEffect, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";

// ---------------------------------------------------------------------------
// Layout mode — drives the adaptive shell layout.
//
//  "chat"        → chat centered at comfortable width, no result panel
//  "split"       → chat narrow + result panel side by side
//  "full-result" → result panel full width, chat collapsed to toggle button
// ---------------------------------------------------------------------------

export type LayoutMode = "chat" | "split" | "full-result";

export interface LayoutState {
  /** Current content-area layout. */
  mode: LayoutMode;
  /** Viewport < 768px. */
  isMobile: boolean;
  /** Viewport 768–1023px. */
  isTablet: boolean;
  /** Viewport ≥ 1024px. */
  isDesktop: boolean;
  /** Switch to a specific mode (user override). */
  setMode: (mode: LayoutMode) => void;
  /** Collapse result panel → chat mode. */
  collapseResult: () => void;
  /** Expand result panel → full-result mode. */
  expandResult: () => void;
}

/**
 * Manages the adaptive layout state.
 *
 * Auto-transitions:
 * - When `hasVisualResult` becomes true  → switch to "split" (unless user overrode)
 * - When `hasVisualResult` becomes false → switch to "chat"
 *
 * User can override at any time via `setMode` / `collapseResult` / `expandResult`.
 * Override is cleared when `hasVisualResult` changes OR `resetKey` changes
 * (e.g. user activates a different message's result).
 */
export function useLayoutMode(hasVisualResult: boolean, resetKey?: unknown): LayoutState {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isTablet = useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const [userOverride, setUserOverride] = useState<LayoutMode | null>(null);

  // Auto mode: chat when no results, full-result when results exist.
  // Per DESIGN.md: content takes full width, chat becomes a popup toggle.
  const autoMode: LayoutMode = hasVisualResult ? "full-result" : "chat";

  // User override takes precedence over auto.
  const mode = userOverride ?? autoMode;

  // Clear override when result state changes or active result switches.
  useEffect(() => {
    setUserOverride(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVisualResult, resetKey]);

  const setMode = useCallback((m: LayoutMode) => setUserOverride(m), []);
  const collapseResult = useCallback(() => setUserOverride("chat"), []);
  const expandResult = useCallback(() => setUserOverride("full-result"), []);

  return { mode, isMobile, isTablet, isDesktop, setMode, collapseResult, expandResult };
}
