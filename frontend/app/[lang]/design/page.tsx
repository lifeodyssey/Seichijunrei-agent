import { EntryScreen } from "@/components/demo/DesignWorkbench";

export default async function DesignHomePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  return <EntryScreen lang={lang} />;
}
