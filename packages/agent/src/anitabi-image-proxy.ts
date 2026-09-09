/**
 * Project Anitabi screenshot URLs onto the public edge image-proxy route.
 *
 * Port of `apps/agent/src/animichi/agents/handlers/image_url_rewrite.py`. Both
 * schemes are matched by prefix on purpose: an `http://` URL used to pass a
 * naive substring test and ship mixed content to production.
 *
 * One deliberate difference from Python: there is no development bypass. That
 * branch existed because a local FastAPI run had no `/img/` proxy in front of
 * it; the edge Worker always serves one (`workers/edge/src/proxy/image-proxy.ts`), so the
 * rewrite is unconditional and no environment can silently skip it.
 */

import type { Point } from "@animichi/contract";

const ANITABI_ORIGINS = ["https://image.anitabi.cn/", "http://image.anitabi.cn/"] as const;

/** The proxied form of one screenshot URL, or the URL untouched. */
export function proxiedScreenshotUrl(url: string): string {
  const origin = ANITABI_ORIGINS.find((candidate) => url.startsWith(candidate));
  if (origin) return `/img/${url.slice(origin.length)}`;
  return url.startsWith("screenshot/") ? `/img/${url}` : url;
}

/** Every row's screenshot URL, proxied. Rows are copied, never mutated. */
export function proxyScreenshots(rows: Point[]): Point[] {
  return rows.map((row) =>
    row.screenshot_url ? { ...row, screenshot_url: proxiedScreenshotUrl(row.screenshot_url) } : row,
  );
}
