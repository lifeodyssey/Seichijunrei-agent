import type { Metadata } from "next";
import "./globals.css";
import { LocaleProvider } from "../lib/i18n-context";

export const metadata: Metadata = {
  title: "聖地巡礼",
  description: "アニメ聖地を探す・ルートを計画する",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
