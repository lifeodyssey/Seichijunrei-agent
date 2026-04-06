"use client";

import { Drawer } from "vaul";
import type { RuntimeResponse } from "@/lib/types";
import GenerativeUIRenderer from "../generative/GenerativeUIRenderer";
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";
import SelectionBar from "../generative/SelectionBar";

interface ResultDrawerProps {
  response: RuntimeResponse | null;
  open: boolean;
  onClose: () => void;
  onSuggest?: (text: string) => void;
  onRouteSelected?: (origin: string) => void;
  defaultOrigin?: string;
  loading?: boolean;
}

/**
 * Mobile-only bottom sheet drawer that wraps GenerativeUIRenderer.
 * On desktop, results appear in SlideOverPanel or FullscreenOverlay.
 * On mobile, the anchor cards open this drawer.
 */
export default function ResultDrawer({
  response,
  open,
  onClose,
  onSuggest,
  onRouteSelected,
  defaultOrigin,
  loading,
}: ResultDrawerProps) {
  const { selectedIds, clear } = usePointSelectionContext();

  return (
    <Drawer.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay
          className="fixed inset-0 z-40 bg-black/60"
          onClick={onClose}
        />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-[var(--color-card)] border-t border-[var(--color-border)] max-h-[90vh]"
          aria-label="Result panel"
        >
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-[var(--color-muted-fg)] opacity-40" />
          </div>
          {selectedIds.size > 0 && (
            <SelectionBar
              count={selectedIds.size}
              defaultOrigin={defaultOrigin ?? ""}
              onRoute={(origin) => onRouteSelected?.(origin)}
              onClear={clear}
              disabled={loading}
            />
          )}
          <div className="flex-1 overflow-y-auto min-h-0 p-4">
            {response ? (
              <GenerativeUIRenderer response={response} onSuggest={onSuggest} />
            ) : loading ? (
              <div className="space-y-4 animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-3/4" />
                <div className="h-48 bg-gray-200 rounded" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
            ) : null}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
