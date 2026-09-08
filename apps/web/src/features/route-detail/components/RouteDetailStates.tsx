import "../../../styles/route-detail.css";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { DEFAULT_LOCALE, isLocale, type Locale } from "../../../i18n/locales";
import { routeDetailCopyFor, type RouteDetailCopy } from "../lib/copy";

/**
 * Branded error + pending states for `/routes/:id`, mirroring the anime page's
 * pattern (the caught error is never rendered — technical text must not reach
 * the user). Retry follows the official Router × Query integration: reset the
 * query error boundary on mount, then `router.invalidate()` reruns the loader.
 */
function useRetry(): () => void {
  const router = useRouter();
  const boundary = useQueryErrorResetBoundary();
  useEffect(() => {
    boundary.reset();
  }, [boundary]);
  return () => void router.invalidate();
}

function useErrorLocale(): Locale {
  const search: Readonly<Record<string, unknown>> = useSearch({ strict: false });
  const hl = search.hl;
  return typeof hl === "string" && isLocale(hl) ? hl : DEFAULT_LOCALE;
}

function RouteErrorActions({ copy, onRetry }: { readonly copy: RouteDetailCopy; readonly onRetry: () => void }) {
  return (
    <p className="m-0 flex items-center justify-center gap-4">
      <button type="button" className="home-link" onClick={onRetry}>{copy.errorRetry}</button>
      <Link className="home-link" to="/">{copy.errorHome}</Link>
    </p>
  );
}

function RouteErrorHeading({ copy }: { readonly copy: RouteDetailCopy }) {
  return (
    <>
      <p className="eyebrow">Animichi</p>
      <h1 id="route-error-title">{copy.errorTitle}</h1>
      <p className="tagline">{copy.errorBody}</p>
    </>
  );
}

export function RouteDetailErrorState() {
  const handleRetry = useRetry();
  const copy = routeDetailCopyFor(useErrorLocale());
  return (
    <main className="app-shell hero compact" aria-labelledby="route-error-title">
      <RouteErrorHeading copy={copy} />
      <RouteErrorActions copy={copy} onRetry={handleRetry} />
    </main>
  );
}

export function RouteDetailPendingState() {
  return (
    <main role="status" aria-label="Loading" className="route-detail">
      <div className="route-skeleton route-skeleton--hero" />
      <div className="route-skeleton route-skeleton--map" />
      <div className="route-skeleton route-skeleton--panel" />
    </main>
  );
}
