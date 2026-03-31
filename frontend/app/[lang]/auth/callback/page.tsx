import { AuthCallbackPage } from "../../../../components/auth/AuthCallbackPage";

export default async function AuthCallback({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  return <AuthCallbackPage locale={lang} />;
}
