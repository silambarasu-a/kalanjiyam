import { assertFarmEnabled } from "@/lib/farm-guard";

export default async function WorkersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertFarmEnabled();
  return <>{children}</>;
}
