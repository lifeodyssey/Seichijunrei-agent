import { NearbyScreen } from "@/components/demo/DesignWorkbench";

export default async function DesignNearbyPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  return <NearbyScreen lang={lang} />;
}
