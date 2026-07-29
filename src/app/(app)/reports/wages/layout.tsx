import { assertFarmEnabled } from "@/lib/farm-guard";

export default async function WagesReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertFarmEnabled();
  return <>{children}</>;
}
