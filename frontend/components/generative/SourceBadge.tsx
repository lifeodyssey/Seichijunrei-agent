"use client";

import { useDict } from "../../lib/i18n-context";

/**
 * Determines whether a screenshot URL was uploaded by a user.
 *
 * Anitabi user-contributed photos have a `/user/` segment in their URL path.
 * All other URLs (including null / empty) are treated as anime-screenshot stills.
 */
function isUserPhoto(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    // Use URL parsing when possible to extract only the pathname.
    const parsed = new URL(url);
    return parsed.pathname.includes("/user/");
  } catch {
    // Fallback for bare paths (e.g. "/user/avatar.jpg") or malformed URLs.
    return url.includes("/user/");
  }
}

interface SourceBadgeProps {
  /** The screenshot URL for this pilgrimage point, or null if absent. */
  screenshotUrl: string | null | undefined;
  /** Episode number. Badge is omitted when null or 0. */
  episode: number | null | undefined;
  /**
   * Pre-formatted episode label string, e.g. "第3話" or "Ep. 3".
   * When omitted the component derives the label from the current locale dict.
   */
  episodeLabel?: string;
}

/**
 * SourceBadge renders two optional overlays on a pilgrimage card:
 *
 * 1. **Source icon** — 📷 for user-contributed photos, 🎬 for anime stills.
 * 2. **Episode badge** — shown only when episode > 0.
 *
 * All colours use CSS variables from the design system (no Tailwind colour classes).
 */
export default function SourceBadge({
  screenshotUrl,
  episode,
  episodeLabel: episodeLabelProp,
}: SourceBadgeProps) {
  const dict = useDict();

  const sourceIcon = isUserPhoto(screenshotUrl) ? "📷" : "🎬";

  const showEpisodeBadge = typeof episode === "number" && episode > 0;

  const episodeLabel =
    episodeLabelProp ??
    (showEpisodeBadge ? dict.grid.episode.replace("{ep}", String(episode)) : "");

  return (
    <>
      {/* Source type icon — always rendered */}
      <span
        aria-label={sourceIcon === "📷" ? "user photo" : "screenshot"}
        style={{
          position: "absolute",
          top: "6px",
          left: "6px",
          fontSize: "12px",
          lineHeight: 1,
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        {sourceIcon}
      </span>

      {/* Episode badge — rendered only when episode > 0 */}
      {showEpisodeBadge && (
        <span
          data-testid="episode-badge"
          style={{
            position: "absolute",
            bottom: "8px",
            left: "8px",
            borderRadius: "2px",
            backgroundColor: "rgba(0,0,0,0.6)",
            padding: "2px 6px",
            fontSize: "10px",
            color: "rgba(255,255,255,0.85)",
            lineHeight: 1.4,
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          {episodeLabel}
        </span>
      )}
    </>
  );
}
