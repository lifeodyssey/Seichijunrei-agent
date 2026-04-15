"use client";

/** Icon sidebar — 56px wide icon rail replacing the 240px text sidebar.
 *
 * Layout spec:
 * - 56px wide, bg uses --color-bg, border-right
 * - Logo: 聖 in primary-colored rounded square (38x38)
 * - Navigation icons: 38x38 touch targets, rounded-8px, hover:muted bg
 * - Bottom section: settings icon
 * - Responsive: hidden on mobile (<1024px) via CSS class; AppShell controls visibility
 */

import type { MouseEvent } from "react";

export type SidebarSection = "search" | "routes" | "history" | "settings";

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
      className="nav-button"
      style={{
        width: 38,
        height: 38,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        border: "none",
        background: active
          ? "var(--color-sidebar-active, oklch(93% 0.025 240))"
          : "transparent",
        color: active
          ? "var(--color-primary, oklch(60% 0.148 240))"
          : "var(--color-muted-fg, oklch(54% 0.032 228))",
        cursor: "pointer",
        transition: "background 0.15s, color 0.15s",
        flexShrink: 0,
      }}
    >
      {children}
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
      style={{
        width: 56,
        minWidth: 56,
        background: "var(--color-bg)",
        borderRight: "1px solid var(--color-border, oklch(85% 0.022 222))",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "14px 0",
        gap: 4,
      }}
    >
      {/* Logo mark */}
      <button
        type="button"
        aria-label="聖地巡礼 home"
        onClick={onNewChat}
        style={{
          fontFamily: "var(--app-font-display, 'Shippori Mincho B1', Georgia, serif)",
          fontSize: 20,
          fontWeight: 800,
          color: "var(--color-primary, oklch(60% 0.148 240))",
          width: 38,
          height: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 10,
          background: "var(--color-sidebar-active, oklch(93% 0.025 240))",
          marginBottom: 12,
          cursor: "pointer",
          border: "none",
          flexShrink: 0,
        }}
      >
        聖
      </button>

      {/* New chat / compose */}
      <NavButton
        label="New chat"
        active={false}
        onClick={onNewChat}
      >
        {/* Compose / pencil icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </NavButton>

      {/* Search */}
      <NavButton
        label="Search"
        active={activeSection === "search"}
        onClick={() => onSectionClick?.("search")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </NavButton>

      {/* Routes */}
      <NavButton
        label="Routes"
        active={activeSection === "routes"}
        onClick={() => onSectionClick?.("routes")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 11l19-9-9 19-2-8-8-2z" />
        </svg>
      </NavButton>

      {/* History */}
      <NavButton
        label="History"
        active={activeSection === "history"}
        onClick={() => onSectionClick?.("history")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="12 8 12 12 14 14" />
          <path d="M3.05 11a9 9 0 1 0 .5-4.5" />
          <polyline points="3 3 3 9 9 9" />
        </svg>
      </NavButton>

      {/* Spacer */}
      <div style={{ flex: 1 }} aria-hidden />

      {/* Settings */}
      <NavButton
        label="Settings"
        active={activeSection === "settings"}
        onClick={() => onSectionClick?.("settings")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </NavButton>
    </aside>
  );
}
