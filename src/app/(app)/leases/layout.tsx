import { assertFarmEnabled } from "@/lib/farm-guard";

export default async function LeasesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertFarmEnabled();
  return <>{children}</>;
}
