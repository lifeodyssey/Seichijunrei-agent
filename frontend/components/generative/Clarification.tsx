"use client";

import { useState } from "react";
import { useDict } from "../../lib/i18n-context";
import type { ClarifyCandidate } from "../../lib/types";

export type { ClarifyCandidate };

interface ClarificationProps {
  message: string;
  options?: string[];
  candidates?: ClarifyCandidate[];
  onSuggest?: (text: string) => void;
}

export default function Clarification({
  message,
  options,
  candidates,
  onSuggest,
}: ClarificationProps) {
  const { clarification: t } = useDict();

  const hasCandidates = candidates !== undefined && candidates.length > 0;
  const hasOptions = options !== undefined && options.length > 0;

  // If we have candidate objects, render the card layout
  if (hasCandidates) {
    const isCompact = candidates.length <= 4;
    return (
      <div className="space-y-3">
        <p className="text-sm font-light leading-relaxed text-[var(--color-fg)]">
          {message}
        </p>
        <div className={isCompact ? "flex gap-3 overflow-x-auto pb-1" : "flex flex-col gap-2"}>
          {candidates.map((candidate) =>
            isCompact ? (
              <CompactCandidateCard
                key={candidate.title}
                candidate={candidate}
                onSelect={() => onSuggest?.(candidate.title)}
              />
            ) : (
              <CandidateCard
                key={candidate.title}
                candidate={candidate}
                onSelect={() => onSuggest?.(candidate.title)}
              />
            ),
          )}
          {isCompact ? (
            <CompactSearchAllCard
              label={t.search_all}
              candidates={candidates}
              onSuggest={onSuggest}
            />
          ) : (
            <SearchAllCard
              label={t.search_all}
              candidates={candidates}
              onSuggest={onSuggest}
            />
          )}
        </div>
      </div>
    );
  }

  // If we have plain string options (legacy), render tappable option buttons
  if (hasOptions) {
    return (
      <div className="space-y-5 py-2">
        <p className="max-w-[65ch] text-sm font-light leading-loose text-[var(--color-fg)]">
          {message}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {options.map((option) => (
            <button
              key={option}
              onClick={() => onSuggest?.(option)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-xs font-light text-[var(--color-fg)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Default fallback: suggestion buttons from dictionary
  return (
    <div className="space-y-5 py-2">
      <p className="max-w-[65ch] text-sm font-light leading-loose text-[var(--color-fg)]">
        {message}
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {t.suggestions.map((s) => (
          <button
            key={s.label}
            onClick={() => onSuggest?.(s.query)}
            className="text-xs font-light text-[var(--color-primary)] underline-offset-2 transition hover:underline"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            {s.label} →
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CandidateCard — anime cover art thumbnail + title + spot count + city
// ---------------------------------------------------------------------------

function CandidateCard({
  candidate,
  onSelect,
}: {
  candidate: ClarifyCandidate;
  onSelect: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const { clarification: t } = useDict();

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={candidate.title}
      className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-left transition-all hover:border-[var(--color-primary)] hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0"
      style={{
        transitionDuration: "var(--duration-fast)",
        transitionTimingFunction: "var(--ease-out-quint)",
      }}
    >
      {/* Thumbnail */}
      <span className="relative flex h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-[var(--color-muted)]">
        {candidate.cover_url && !imgError ? (
          <img
            src={candidate.cover_url}
            alt={candidate.title}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <PlaceholderThumbnail />
        )}
      </span>

      {/* Text */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-[var(--color-fg)]">
          {candidate.title}
        </span>
        <span className="text-[11px] text-[var(--color-muted-fg)]">
          {candidate.spot_count} {t.spot_label ?? "spots"} · {candidate.city}
        </span>
      </span>

      {/* Arrow */}
      <span
        className="shrink-0 text-base text-[var(--color-primary)] transition-transform"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        ›
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// SearchAllCard — "全作品まとめて検索" option at the bottom
// ---------------------------------------------------------------------------

function SearchAllCard({
  label,
  candidates,
  onSuggest,
}: {
  label: string;
  candidates: ClarifyCandidate[];
  onSuggest?: (text: string) => void;
}) {
  function handleClick() {
    // Build a combined query covering all candidate titles
    const titles = candidates.map((c) => c.title).join("・");
    onSuggest?.(titles);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-left transition-all hover:border-[var(--color-primary)] hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0"
      style={{
        transitionDuration: "var(--duration-fast)",
        transitionTimingFunction: "var(--ease-out-quint)",
      }}
    >
      {/* Icon */}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-muted)] text-sm">
        {"\uD83D\uDD0D"}
      </span>

      {/* Text */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-[var(--color-fg)]">{label}</span>
      </span>

      {/* Arrow */}
      <span
        className="shrink-0 text-base text-[var(--color-primary)] transition-transform"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        ›
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// CompactCandidateCard — horizontal scroll card variant (≤ 4 candidates)
// ---------------------------------------------------------------------------

function CompactCandidateCard({
  candidate,
  onSelect,
}: {
  candidate: ClarifyCandidate;
  onSelect: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const { clarification: t } = useDict();

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={candidate.title}
      className="flex w-[130px] shrink-0 flex-col overflow-hidden rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] transition-all hover:border-[var(--color-primary)] hover:-translate-y-0.5"
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      <div className="h-[80px] w-full overflow-hidden bg-[var(--color-muted)]">
        {candidate.cover_url && !imgError ? (
          <img
            src={candidate.cover_url}
            alt={candidate.title}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <PlaceholderThumbnail />
        )}
      </div>
      <div className="flex flex-col gap-0.5 p-2.5">
        <span
          className="line-clamp-2 text-[13px] font-medium text-[var(--color-fg)]"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {candidate.title}
        </span>
        <span className="text-[11px] font-medium text-[var(--color-primary)]">
          {candidate.spot_count} {t.spot_label ?? "spots"}
        </span>
        <span className="text-[11px] text-[var(--color-muted-fg)]">{candidate.city}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// CompactSearchAllCard — matches compact horizontal card style
// ---------------------------------------------------------------------------

function CompactSearchAllCard({
  label,
  candidates,
  onSuggest,
}: {
  label: string;
  candidates: ClarifyCandidate[];
  onSuggest?: (text: string) => void;
}) {
  function handleClick() {
    const titles = candidates.map((c) => c.title).join("\u30FB");
    onSuggest?.(titles);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      className="flex w-[130px] shrink-0 flex-col overflow-hidden rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] transition-all hover:border-[var(--color-primary)] hover:-translate-y-0.5"
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      <div className="flex h-[80px] w-full items-center justify-center bg-[var(--color-muted)] text-2xl">
        {"\uD83D\uDD0D"}
      </div>
      <div className="flex flex-col gap-0.5 p-2.5">
        <span
          className="line-clamp-2 text-[13px] font-medium text-[var(--color-fg)]"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {label}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// PlaceholderThumbnail — shown when cover_url is null or image fails to load
// ---------------------------------------------------------------------------

function PlaceholderThumbnail() {
  return (
    <span className="flex h-full w-full items-center justify-center text-[var(--color-muted-fg)]">
      {"\uD83C\uDFAC"}
    </span>
  );
}
