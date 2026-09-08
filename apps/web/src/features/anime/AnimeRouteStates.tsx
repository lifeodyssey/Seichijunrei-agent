import "../../styles/anime.css";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { DEFAULT_LOCALE, isLocale, type Locale } from "../../i18n/locales";
import { animeCopyFor, type AnimeCopy } from "./copy";

/**
 * Branded error + pending states for `/anime/:id` (NotFound style). The
 * caught error is intentionally never rendered: technical text (env vars,
 * upstream messages, stack traces) must not reach the user.
 *
 * Retry follows the official Router x Query integration: reset the query
 * error boundary on mount, then `router.invalidate()` reruns the loader.
 */
function useRetry(): () => void {
  const router = useRouter();
  const boundary = useQueryErrorResetBoundary();
  useEffect(() => {
    boundary.reset();
  }, [boundary]);
  return () => void router.invalidate();
}

/** The loader failed, so no loaderData: the `hl` search param is the source. */
function useErrorLocale(): Locale {
  const search: Readonly<Record<string, unknown>> = useSearch({ strict: false });
  const hl = search.hl;
  return typeof hl === "string" && isLocale(hl) ? hl : DEFAULT_LOCALE;
}

type ErrorCopyProps = Readonly<{ copy: AnimeCopy }>;

function AnimeErrorActions({ copy, onRetry }: ErrorCopyProps & Readonly<{ onRetry: () => void }>) {
  return (
    <p className="anime-actions">
      <button type="button" className="anime-press" onClick={onRetry}>{copy.errorRetry}</button>
      <Link className="anime-press" to="/">{copy.errorHome}</Link>
    </p>
  );
}

function AnimeErrorHeading({ copy }: ErrorCopyProps) {
  return (
    <>
      <p className="eyebrow">Animichi</p>
      <h1 id="anime-error-title">{copy.errorTitle}</h1>
      <p className="tagline">{copy.errorBody}</p>
    </>
  );
}

export function AnimeErrorState() {
  const handleRetry = useRetry();
  const copy = animeCopyFor(useErrorLocale());
  return (
    <main className="app-shell hero compact anime-error" aria-labelledby="anime-error-title">
      <AnimeErrorHeading copy={copy} />
      <AnimeErrorActions copy={copy} onRetry={handleRetry} />
    </main>
  );
}

export function AnimePendingState() {
  return (
    <main role="status" aria-label="Loading" className="anime-page">
      <div className="anime-skeleton h-24" />
      <div className="anime-skeleton h-40" />
      <div className="anime-skeleton h-64" />
    </main>
  );
}
