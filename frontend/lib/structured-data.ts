const SITE_URL = "https://seichijunrei.zhenjia.org";

export const websiteJsonLd = {
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

export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Seichijunrei",
  url: SITE_URL,
  logo: `${SITE_URL}/og-image.png`,
};

export const faqJsonLd = {
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
