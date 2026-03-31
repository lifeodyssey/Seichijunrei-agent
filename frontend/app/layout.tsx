import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "聖地巡礼 AI",
  description: "アニメ聖地を探す・ルートを計画する",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
