import { GoldOrnamentDetail } from "@/components/investments/gold/gold-ornament-detail";

export default async function GoldOrnamentPage({
  params,
}: {
  params: Promise<{ ornamentId: string }>;
}) {
  const { ornamentId } = await params;
  return <GoldOrnamentDetail ornamentId={ornamentId} />;
}
