"use client";

import type { RouteHistoryRecord } from "../../lib/types";

interface SidebarProps {
  routeHistory: RouteHistoryRecord[];
  onNewChat: () => void;
}

export default function Sidebar({ routeHistory, onNewChat }: SidebarProps) {
  return (
    <aside className="hidden w-64 flex-col border-r border-[var(--color-border)] bg-[var(--color-sidebar)] lg:flex">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-[var(--color-sidebar-border)] px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-primary)] text-sm font-bold text-[var(--color-primary-fg)]">
          聖
        </div>
        <span className="text-sm font-semibold text-[var(--color-sidebar-accent-fg)]">
          聖地巡礼
        </span>
      </div>

      {/* New chat button */}
      <div className="px-3 pt-3">
        <button
          onClick={onNewChat}
          className="w-full rounded-lg border border-[var(--color-sidebar-border)] px-3 py-2 text-left text-sm text-[var(--color-sidebar-fg)] transition hover:bg-[var(--color-sidebar-accent)]"
        >
          + 新しい会話
        </button>
      </div>

      {/* Route history */}
      <div className="flex-1 overflow-y-auto px-3 pt-4">
        {routeHistory.length > 0 && (
          <>
            <p className="px-2 pb-2 text-xs font-medium text-[var(--color-sidebar-fg)]">
              最近の検索
            </p>
            {routeHistory.map((record, idx) => (
              <div
                key={record.route_id ?? idx}
                className="mb-1 rounded-lg px-2 py-2 text-sm text-[var(--color-sidebar-accent-fg)] hover:bg-[var(--color-sidebar-accent)]"
              >
                <p className="truncate font-medium">
                  {record.bangumi_id}
                </p>
                <p className="text-xs text-[var(--color-sidebar-fg)]">
                  {record.point_count}スポット · {record.status}
                </p>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--color-sidebar-border)] px-5 py-4">
        <p className="text-xs text-[var(--color-sidebar-fg)]">巡礼者</p>
        <p className="text-xs text-[var(--color-sidebar-fg)]">pilgrim@seichi.jp</p>
      </div>
    </aside>
  );
}
