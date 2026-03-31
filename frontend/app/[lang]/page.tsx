import { LocaleRedirect } from "../../components/routing/LocaleRedirect";

export default async function Home({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  return <LocaleRedirect target={`/${lang}/design/`} />;
}
