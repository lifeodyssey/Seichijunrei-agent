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
      <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted-fg)]">
        {t.no_results}
      </div>
    );
  }

  const animeTitle = results.rows[0]?.title_cn || results.rows[0]?.title || "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--color-primary)]/15 px-2 py-0.5 text-xs font-medium text-[var(--color-primary)]">
          search_by_bangumi
        </span>
        {animeTitle && (
          <span className="text-sm font-medium text-[var(--color-fg)]">
            {animeTitle}
          </span>
        )}
        <span className="text-xs text-[var(--color-muted-fg)]">
          {t.count.replace("{count}", String(results.row_count))} · {results.strategy}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {results.rows.map((point) => (
          <div
            key={point.id}
            className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]"
          >
            <div className="relative aspect-[16/10] bg-[var(--color-muted)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={point.screenshot_url}
                alt={point.name_cn || point.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="space-y-1 p-3">
              <p className="text-sm font-medium text-[var(--color-fg)]">
                {point.name_cn || point.name}
              </p>
              <p className="text-xs text-[var(--color-muted-fg)]">
                {point.title_cn || point.title}
              </p>
              <span className="inline-block rounded bg-[var(--color-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--color-fg)]">
                {t.episode.replace("{ep}", String(point.episode))}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
