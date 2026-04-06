"use client";

import { useCallback, useEffect } from "react";

interface FullscreenOverlayProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function FullscreenOverlay({ open, onClose, children }: FullscreenOverlayProps) {
  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, handleEsc]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-bg)] animate-in fade-in duration-200">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 rounded-full bg-white/80 backdrop-blur p-2 shadow-md hover:bg-white transition"
        style={{ transitionDuration: "var(--duration-fast)" }}
        aria-label="Close"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
      {children}
    </div>
  );
}
