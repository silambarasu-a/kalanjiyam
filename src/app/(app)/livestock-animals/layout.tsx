import { assertFarmEnabled } from "@/lib/farm-guard";

export default async function LivestockAnimalsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertFarmEnabled();
  return <>{children}</>;
}
