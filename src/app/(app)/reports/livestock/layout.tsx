import { assertFarmEnabled } from "@/lib/farm-guard";

export default async function LivestockReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertFarmEnabled();
  return <>{children}</>;
}
