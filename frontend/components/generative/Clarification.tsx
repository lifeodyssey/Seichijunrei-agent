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

  // If we have candidate objects, render the vertical card layout
  if (hasCandidates) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-light leading-relaxed text-[var(--color-fg)]">
          {message}
        </p>
        <div className="flex flex-col gap-2">
          {candidates.map((candidate) => (
            <CandidateCard
              key={candidate.title}
              candidate={candidate}
              onSelect={() => onSuggest?.(candidate.title)}
            />
          ))}
          <SearchAllCard
            label={t.search_all}
            candidates={candidates}
            onSuggest={onSuggest}
          />
        </div>
      </div>
    );
  }

  // If we have plain string options (legacy), convert to candidate-like cards
  if (hasOptions) {
    const syntheticCandidates: ClarifyCandidate[] = options.map((opt) => ({
      title: opt,
      cover_url: null,
      spot_count: 0,
      city: "",
    }));
    return (
      <div className="space-y-3">
        <p className="text-sm font-light leading-relaxed text-[var(--color-fg)]">
          {message}
        </p>
        <div className="flex flex-col gap-2">
          {syntheticCandidates.map((c) => (
            <CandidateCard
              key={c.title}
              candidate={c}
              onSelect={() => onSuggest?.(c.title)}
            />
          ))}
        </div>
      </div>
    );
  }

  // Default fallback: suggestion buttons from dictionary as candidate-like cards
  return (
    <div className="space-y-3">
      <p className="text-sm font-light leading-relaxed text-[var(--color-fg)]">
        {message}
      </p>
      <div className="flex flex-col gap-2">
        {t.suggestions.map((s) => (
          <FallbackSuggestionCard
            key={s.label}
            label={s.label}
            onSelect={() => onSuggest?.(s.query)}
          />
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
        minHeight: 44,
      }}
    >
      {/* Thumbnail — enlarged for better anime cover visibility */}
      <span className="relative flex h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-[var(--color-muted)]">
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
        <span
          className="truncate text-sm font-medium text-[var(--color-fg)]"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {candidate.title}
        </span>
        {(candidate.spot_count > 0 || candidate.city) && (
          <span className="text-[11px] text-[var(--color-muted-fg)]">
            {candidate.spot_count > 0 && <>{candidate.spot_count} {t.spot_label ?? "spots"}</>}
            {candidate.spot_count > 0 && candidate.city && " · "}
            {candidate.city}
          </span>
        )}
      </span>

      {/* Arrow */}
      <span
        className="shrink-0 text-base text-[var(--color-primary)] transition-transform"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        →
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
        minHeight: 44,
      }}
    >
      {/* Icon */}
      <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--color-muted)] text-sm">
        {"\uD83D\uDD0D"}
      </span>

      {/* Text */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="truncate text-sm font-medium text-[var(--color-fg)]"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {label}
        </span>
      </span>

      {/* Arrow */}
      <span
        className="shrink-0 text-base text-[var(--color-primary)] transition-transform"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        →
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// FallbackSuggestionCard — used when there are no options or candidates
// ---------------------------------------------------------------------------

function FallbackSuggestionCard({
  label,
  onSelect,
}: {
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-left transition-all hover:border-[var(--color-primary)] hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0"
      style={{
        transitionDuration: "var(--duration-fast)",
        transitionTimingFunction: "var(--ease-out-quint)",
        minHeight: 44,
      }}
    >
      {/* Emoji icon instead of cover */}
      <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--color-muted)] text-sm">
        {"\uD83C\uDFAC"}
      </span>

      {/* Text */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="truncate text-sm font-medium text-[var(--color-fg)]"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {label}
        </span>
      </span>

      {/* Arrow */}
      <span
        className="shrink-0 text-base text-[var(--color-primary)] transition-transform"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        →
      </span>
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
