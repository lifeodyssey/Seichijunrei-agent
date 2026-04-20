"use client";

import type { RouteData } from "../../lib/types";

interface FallbackListProps {
  data: RouteData;
}

export default function FallbackList({ data }: FallbackListProps) {
  return (
    <div className="flex-1 overflow-auto p-4">
      <ol className="space-y-2">
        {data.route.ordered_points.map((pt, idx) => (
          <li key={pt.id} className="flex items-center gap-2 text-sm text-[var(--color-fg)]">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[10px] font-bold text-white">
              {idx + 1}
            </span>
            <span className="truncate">{pt.name_cn || pt.name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
