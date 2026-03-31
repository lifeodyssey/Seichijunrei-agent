"use client";

import type { SearchResultData } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";

interface PilgrimageGridProps {
  data: SearchResultData;
}

export default function PilgrimageGrid({ data }: PilgrimageGridProps) {
  const { grid: t } = useDict();
  const { results } = data;

  if (results.status === "empty" || results.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted-fg)]">
        {t.no_results}
      </div>
    );
  }

  const animeTitle = results.rows[0]?.title_cn || results.rows[0]?.title || "";

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        {animeTitle && (
          <h2 className="font-[family-name:var(--app-font-display)] text-base font-semibold text-[var(--color-fg)]">
            {animeTitle}
          </h2>
        )}
        <span className="text-xs text-[var(--color-muted-fg)]">
          {t.count.replace("{count}", String(results.row_count))}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {results.rows.map((point) => (
          <div
            key={point.id}
            className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]"
          >
            <div className="relative aspect-[4/3] bg-[var(--color-muted)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={point.screenshot_url}
                alt={point.name_cn || point.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="space-y-0.5 p-2.5">
              <p className="truncate text-xs font-medium text-[var(--color-fg)]">
                {point.name_cn || point.name}
              </p>
              {point.episode != null && point.episode !== 0 && (
                <p className="text-[10px] text-[var(--color-muted-fg)]">
                  {t.episode.replace("{ep}", String(point.episode))}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
