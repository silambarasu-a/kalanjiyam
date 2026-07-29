import { assertFarmEnabled } from "@/lib/farm-guard";

export default async function FarmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertFarmEnabled();
  return <>{children}</>;
}
