import { assertFarmEnabled } from "@/lib/farm-guard";

export default async function LivestockContractsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertFarmEnabled();
  return <>{children}</>;
}
