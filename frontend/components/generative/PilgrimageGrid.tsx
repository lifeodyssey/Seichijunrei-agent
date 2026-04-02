"use client";

import { useState } from "react";
import type { SearchResultData, PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";

function PilgrimageCard({
  point,
  idx,
  episodeLabel,
}: {
  point: PilgrimagePoint;
  idx: number;
  episodeLabel: string;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className={`relative overflow-hidden rounded-sm bg-[var(--color-muted)] ${
        idx === 0 ? "col-span-2" : ""
      }`}
    >
      <div
        className={`relative bg-[var(--color-muted)] ${
          idx === 0 ? "aspect-video" : "aspect-[4/3]"
        }`}
      >
        {point.screenshot_url && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={point.screenshot_url}
            alt={point.name_cn || point.name}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span
              className="select-none font-[family-name:var(--app-font-display)] text-2xl"
              style={{
                color: "color-mix(in oklch, var(--color-fg) 12%, transparent)",
              }}
            >
              聖
            </span>
          </div>
        )}
      </div>

      {point.episode != null && point.episode !== 0 && (
        <span className="absolute bottom-2 left-2 rounded-sm bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80">
          {episodeLabel.replace("{ep}", String(point.episode))}
        </span>
      )}

      <div className="pb-2 pt-1.5">
        <p className="truncate text-xs font-light text-[var(--color-fg)]">
          {point.name_cn || point.name}
        </p>
      </div>
    </div>
  );
}

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
          <PilgrimageCard
            key={point.id}
            point={point}
            idx={idx}
            episodeLabel={t.episode}
          />
        ))}
      </div>
    </div>
  );
}
