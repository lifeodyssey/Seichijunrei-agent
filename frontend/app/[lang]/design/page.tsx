import { LocaleRedirect } from "../../../components/routing/LocaleRedirect";

export default async function DesignHomePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  return <LocaleRedirect target={`/${lang}/`} />;
}
