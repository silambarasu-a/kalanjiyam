import { assertFarmEnabled } from "@/lib/farm-guard";

export default async function CropsReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertFarmEnabled();
  return <>{children}</>;
}
