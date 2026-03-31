import { RouteScreen } from "@/components/demo/DesignWorkbench";

export default async function DesignRoutePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  return <RouteScreen lang={lang} />;
}
