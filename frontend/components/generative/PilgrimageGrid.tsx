"use client";

import type { SearchResultData } from "../../lib/types";

interface PilgrimageGridProps {
  data: SearchResultData;
}

export default function PilgrimageGrid({ data }: PilgrimageGridProps) {
  const { results } = data;

  if (results.status === "empty" || results.rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted-fg)]">
        見つかりませんでした。別の作品名で試してください。
      </div>
    );
  }

  const animeTitle = results.rows[0]?.title_cn || results.rows[0]?.title || "";

  return (
    <div className="space-y-3">
      {/* Header */}
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
          {results.row_count}件 · {results.strategy}
        </span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {results.rows.map((point) => (
          <div
            key={point.id}
            className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]"
          >
            {/* Screenshot */}
            <div className="relative aspect-[16/10] bg-[var(--color-muted)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={point.screenshot_url}
                alt={point.cn_name || point.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            {/* Info */}
            <div className="space-y-1 p-3">
              <p className="text-sm font-medium text-[var(--color-fg)]">
                {point.cn_name || point.name}
              </p>
              <p className="text-xs text-[var(--color-muted-fg)]">
                {point.title_cn || point.title}
              </p>
              <span className="inline-block rounded bg-[var(--color-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--color-fg)]">
                第{point.episode}話
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
