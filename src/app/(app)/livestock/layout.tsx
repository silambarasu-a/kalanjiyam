import { assertFarmEnabled } from "@/lib/farm-guard";

export default async function LivestockLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertFarmEnabled();
  return <>{children}</>;
}
