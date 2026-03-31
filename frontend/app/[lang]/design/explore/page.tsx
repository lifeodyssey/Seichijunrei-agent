import { ExploreScreen } from "@/components/demo/DesignWorkbench";

export default async function DesignExplorePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  return <ExploreScreen lang={lang} />;
}
