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
      <div className="py-8 text-sm font-light text-[var(--color-muted-fg)]">
        {t.no_results}
      </div>
    );
  }

  const animeTitle = results.rows[0]?.title_cn || results.rows[0]?.title || "";

  return (
    <div className="space-y-5">
      {/* Editorial section header */}
      <div className="flex items-baseline gap-4">
        {animeTitle && (
          <h2 className="font-[family-name:var(--app-font-display)] text-lg font-semibold text-[var(--color-fg)]">
            {animeTitle}
          </h2>
        )}
        <span className="text-xs font-light text-[var(--color-muted-fg)]">
          {t.count.replace("{count}", String(results.row_count))}
        </span>
      </div>

      {/* Photo spread — featured first card */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {results.rows.map((point, idx) => (
          <div
            key={point.id}
            className={`relative overflow-hidden rounded-sm bg-[var(--color-muted)] ${
              idx === 0 ? "col-span-2" : ""
            }`}
          >
            {/* Image */}
            <div
              className={`relative bg-[var(--color-muted)] ${
                idx === 0 ? "aspect-video" : "aspect-[4/3]"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {point.screenshot_url && (
                <img
                  src={point.screenshot_url}
                  alt={point.name_cn || point.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              )}
            </div>

            {/* Episode overlay */}
            {point.episode != null && point.episode !== 0 && (
              <span className="absolute bottom-2 left-2 rounded-sm bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80">
                {t.episode.replace("{ep}", String(point.episode))}
              </span>
            )}

            {/* Caption below image */}
            <div className="pb-2 pt-1.5">
              <p className="truncate text-xs font-light text-[var(--color-fg)]">
                {point.name_cn || point.name}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
