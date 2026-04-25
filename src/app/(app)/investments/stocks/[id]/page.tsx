import { StockHoldingDetail } from "@/components/investments/stock-holding-detail";

export default async function StockHoldingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StockHoldingDetail holdingId={id} />;
}
