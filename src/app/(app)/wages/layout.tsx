import { assertFarmEnabled } from "@/lib/farm-guard";

export default async function WagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertFarmEnabled();
  return <>{children}</>;
}
