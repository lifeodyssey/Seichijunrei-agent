"use client";

import { Drawer } from "vaul";
import ResultPanel from "./ResultPanel";
import type { RuntimeResponse } from "@/lib/types";

interface ResultDrawerProps {
  response: RuntimeResponse | null;
  open: boolean;
  onClose: () => void;
  onSuggest?: (text: string) => void;
  loading?: boolean;
}

/**
 * Mobile-only bottom sheet drawer that wraps ResultPanel.
 * On desktop, ResultPanel renders directly in the three-column layout.
 * On mobile, the ◈ anchor opens this drawer.
 */
export default function ResultDrawer({
  response,
  open,
  onClose,
  onSuggest,
  loading,
}: ResultDrawerProps) {
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
          <div className="flex-1 overflow-y-auto min-h-0">
            <ResultPanel activeResponse={response} onSuggest={onSuggest} loading={loading} />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
