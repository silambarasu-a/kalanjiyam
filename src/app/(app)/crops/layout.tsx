import { assertFarmEnabled } from "@/lib/farm-guard";

export default async function CropsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertFarmEnabled();
  return <>{children}</>;
}
