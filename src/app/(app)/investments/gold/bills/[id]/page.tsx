import { GoldBillDetail } from "@/components/investments/gold/gold-bill-detail";

export default async function GoldBillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GoldBillDetail billId={id} />;
}
