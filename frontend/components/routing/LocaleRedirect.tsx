"use client";

import Link from "next/link";
import { useEffect } from "react";
import { pickPreferredLocale } from "../../lib/locale";

function normalizeTarget(target: string) {
  if (target === "/") return target;
  return target.endsWith("/") ? target : `${target}/`;
}

export function LocaleRedirect({
  suffix,
  target,
}: {
  suffix?: string;
  target?: string;
}) {
  const fallbackTarget = normalizeTarget(
    target ?? `/${pickPreferredLocale(undefined)}${suffix ?? "/"}`,
  );

  useEffect(() => {
    const localeTarget = target
      ? normalizeTarget(target)
      : normalizeTarget(
          `/${pickPreferredLocale(navigator.languages)}${suffix ?? "/"}`,
        );

    window.location.replace(localeTarget);
  }, [suffix, target]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-6 text-center">
      <div className="max-w-md space-y-4 rounded-[28px] border border-[var(--color-border)] bg-[var(--color-card)] p-8 shadow-sm">
        <p className="text-sm uppercase tracking-[0.24em] text-[var(--color-muted-fg)]">
          Seichijunrei
        </p>
        <h1 className="text-3xl font-semibold tracking-[-0.04em] text-[var(--color-fg)]">
          Redirecting to your workspace
        </h1>
        <p className="text-sm leading-7 text-[var(--color-muted-fg)]">
          If nothing happens, continue with the link below.
        </p>
        <Link
          href={fallbackTarget}
          className="inline-flex rounded-full bg-[var(--color-primary)] px-5 py-2.5 text-sm font-medium text-white"
        >
          Open Seichijunrei
        </Link>
      </div>
    </main>
  );
}
