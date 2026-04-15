"use client";

import { useState } from "react";
import { Drawer } from "vaul";
import type { RuntimeResponse } from "@/lib/types";
import GenerativeUIRenderer from "../generative/GenerativeUIRenderer";
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";
import SelectionBar from "../generative/SelectionBar";

interface ResultSheetProps {
  response: RuntimeResponse | null;
  open: boolean;
  onClose: () => void;
  onSuggest?: (text: string) => void;
  onRouteSelected?: (origin: string) => void;
  defaultOrigin?: string;
  loading?: boolean;
}

/**
 * Mobile-only bottom sheet for result viewing.
 * Uses vaul Drawer with a drag handle, peek (40vh) and full (90vh) snap points.
 * Replaces ResultDrawer.
 */
export default function ResultSheet({
  response,
  open,
  onClose,
  onSuggest,
  onRouteSelected,
  defaultOrigin,
  loading,
}: ResultSheetProps) {
  const { selectedIds, clear } = usePointSelectionContext();
  const [snap, setSnap] = useState<number | string | null>(0.4);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => !o && onClose()}
      snapPoints={[0.4, 0.9]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-[var(--color-card)] border-t border-[var(--color-border)]"
          style={{ borderRadius: "16px 16px 0 0", maxHeight: "90vh" }}
          aria-label="Result panel"
          role="region"
        >
          {/* Drag handle */}
          <Drawer.Handle
            data-drag-handle
            className="mx-auto mt-3 mb-2 shrink-0 rounded-full bg-[var(--color-muted-fg)] opacity-40"
            style={{ width: 36, height: 4 }}
          />

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
