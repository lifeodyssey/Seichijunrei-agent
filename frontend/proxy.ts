import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const locales = ["ja", "zh"];
const defaultLocale = "ja";

function getPreferredLocale(request: NextRequest): string {
  const accept = request.headers.get("accept-language") ?? "";
  for (const locale of locales) {
    if (accept.includes(locale)) return locale;
  }
  // Check for Chinese variants (zh-CN, zh-TW, zh-Hans, etc.)
  if (accept.includes("zh")) return "zh";
  return defaultLocale;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip internal paths and static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return;
  }

  // Already has a locale prefix
  if (locales.some((l) => pathname.startsWith(`/${l}/`) || pathname === `/${l}`)) {
    return;
  }

  // Redirect to preferred locale
  const locale = getPreferredLocale(request);
  request.nextUrl.pathname = `/${locale}${pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
