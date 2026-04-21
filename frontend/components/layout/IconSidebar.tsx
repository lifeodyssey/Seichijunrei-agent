"use client";

/** Icon sidebar — 60px wide, always collapsed per DESIGN.md.
 *
 * Layout spec (from DESIGN.md):
 * - 60px wide, bg uses --color-bg, border-right
 * - Logo: Torii SVG (28px) in brand-soft rounded square (44x44)
 * - Navigation icons: 44px touch targets, rounded-8px, hover:muted bg, hover tooltip
 * - Items: New Chat, History, Favorites, Settings (no Search — chat IS search)
 * - Bottom section: settings icon
 * - Responsive: hidden on mobile (<1024px); AppShell controls visibility
 */

import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";

export type SidebarSection = "history" | "favorites" | "settings";

interface IconSidebarProps {
  onNewChat: () => void;
  activeSection?: SidebarSection;
  onSectionClick?: (section: SidebarSection) => void;
}

interface NavButtonProps {
  label: string;
  active?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

function NavButton({ label, active = false, onClick, children }: NavButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-active={active ? "true" : "false"}
      onClick={onClick}
      className={cn(
        "group relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--r-md)] border-none cursor-pointer transition-colors duration-150",
        active
          ? "bg-[var(--color-sidebar-active)] text-[var(--color-primary)]"
          : "bg-transparent text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)]"
      )}
    >
      {children}
      {/* Hover tooltip */}
      <span className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-[var(--r-sm)] bg-[var(--color-fg)] px-2.5 py-1 text-xs font-medium text-[var(--color-bg)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 z-20">
        {label}
      </span>
    </button>
  );
}

export default function IconSidebar({
  onNewChat,
  activeSection,
  onSectionClick,
}: IconSidebarProps) {
  return (
    <aside
      data-testid="icon-sidebar"
      className="flex w-[60px] min-w-[60px] flex-col items-center gap-1 border-r border-[var(--color-border)] bg-[var(--color-bg)] py-3"
    >
      {/* Torii logo — brand-soft bg, 44x44 rounded square */}
      <button
        type="button"
        aria-label="聖地巡礼 home"
        onClick={onNewChat}
        className="group relative mb-3 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[var(--r-lg)] border-none bg-[var(--color-brand-soft)] transition-transform duration-150 hover:scale-105"
      >
        <svg viewBox="0 0 72 72" width="28" height="28" fill="none" aria-hidden>
          <rect x="12" y="16" width="48" height="5" rx="2.5" fill="var(--color-brand)" />
          <rect x="8" y="14" width="56" height="3" rx="1.5" fill="var(--color-brand)" />
          <rect x="16" y="21" width="5" height="35" rx="1" fill="var(--color-brand)" />
          <rect x="51" y="21" width="5" height="35" rx="1" fill="var(--color-brand)" />
          <rect x="12" y="30" width="48" height="3" rx="1.5" fill="var(--color-brand)" opacity=".5" />
          <rect x="2" y="2" width="7" height="1.5" rx=".75" fill="var(--color-muted-fg)" />
          <rect x="2" y="2" width="1.5" height="7" rx=".75" fill="var(--color-muted-fg)" />
          <rect x="63" y="2" width="7" height="1.5" rx=".75" fill="var(--color-muted-fg)" />
          <rect x="68.5" y="2" width="1.5" height="7" rx=".75" fill="var(--color-muted-fg)" />
        </svg>
      </button>

      {/* New chat */}
      <NavButton label="新对话" active={false} onClick={onNewChat}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </NavButton>

      {/* History */}
      <NavButton label="历史" active={activeSection === "history"} onClick={() => onSectionClick?.("history")}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="12 8 12 12 14 14" />
          <path d="M3.05 11a9 9 0 1 0 .5-4.5" />
          <polyline points="3 3 3 9 9 9" />
        </svg>
      </NavButton>

      {/* Favorites */}
      <NavButton label="收藏" active={activeSection === "favorites"} onClick={() => onSectionClick?.("favorites")}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </NavButton>

      {/* Spacer */}
      <div className="flex-1" aria-hidden />

      {/* Settings */}
      <NavButton label="设置" active={activeSection === "settings"} onClick={() => onSectionClick?.("settings")}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </NavButton>
    </aside>
  );
}
