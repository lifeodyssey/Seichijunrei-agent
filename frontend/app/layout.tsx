import type { Metadata } from "next";
import "./globals.css";
import { LocaleProvider } from "../lib/i18n-context";
import MSWProvider from "../mocks/MSWProvider";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import {
  websiteJsonLd,
  organizationJsonLd,
  faqJsonLd,
} from "@/lib/structured-data";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const SITE_URL = "https://seichijunrei.zhenjia.org";
const SITE_TITLE =
  "アニメ聖地巡礼 スポット検索・ルート計画 | Seichijunrei";
const SITE_DESCRIPTION =
  "アニメ聖地巡礼のスポット検索・ルート計画サービス。作品名から聖地巡礼の場所を探して、最適な巡礼ルートを自動生成。アニメの舞台を地図で確認しよう。";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: "/",
    languages: {
      ja: "/",
      zh: "/",
      en: "/",
      "x-default": "/",
    },
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: "Seichijunrei",
    locale: "ja_JP",
    type: "website",
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "聖地巡礼マップ - アニメ聖地検索",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [`${SITE_URL}/og-image.png`],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ja"
      className={cn("h-full antialiased", "font-sans", geist.variable)}
      suppressHydrationWarning
    >

      <head>
        {/* Preload Mapbox GL JS — starts download before any map component mounts */}
        <link
          rel="preload"
          href="https://api.mapbox.com/mapbox-gl-js/v3.22.0/mapbox-gl.js"
          as="script"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="https://api.mapbox.com/mapbox-gl-js/v3.22.0/mapbox-gl.css"
          as="style"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
        <MSWProvider>
          <LocaleProvider>{children}</LocaleProvider>
        </MSWProvider>
      </body>
    </html>
  );
}
