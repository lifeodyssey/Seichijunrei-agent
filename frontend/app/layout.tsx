import type { Metadata } from "next";
import "./globals.css";
import { LocaleProvider } from "../lib/i18n-context";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const SITE_URL = "https://seichijunrei.zhenjia.org";
const SITE_TITLE =
  "聖地巡礼マップ - アニメ聖地巡礼スポット検索・ルート計画 | Seichijunrei";
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

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Seichijunrei",
  url: SITE_URL,
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_URL}/?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Seichijunrei",
  url: SITE_URL,
  logo: `${SITE_URL}/og-image.png`,
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "聖地巡礼とは何ですか？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "聖地巡礼とは、アニメや映画の舞台となった実在の場所を訪れることです。Seichijunreiでは、作品名からスポットを検索し、効率的な巡礼ルートを自動生成できます。",
      },
    },
    {
      "@type": "Question",
      name: "どのアニメの聖地を検索できますか？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Bangumi.tvのデータベースと連携し、数千作品の聖地情報を提供しています。作品名を入力するだけで、関連するスポットが地図上に表示されます。",
      },
    },
    {
      "@type": "Question",
      name: "ルート計画はどのように使いますか？",
      acceptedAnswer: {
        "@type": "Answer",
        text: "スポット検索後に「ルートを作って」と入力すると、最寄り順で効率的な巡礼ルートを自動生成します。複数のスポットを選択してカスタムルートも作成できます。",
      },
    },
  ],
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
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(websiteJsonLd),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(faqJsonLd),
          }}
        />
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
