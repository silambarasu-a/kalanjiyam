import {
  LayoutDashboard,
  ArrowLeftRight,
  ArrowRightLeft,
  Wallet,
  CreditCard,
  Tags,
  Users,
  UserCircle2,
  Sprout,
  PawPrint,
  FileSignature,
  HardHat,
  CalendarClock,
  Landmark,
  Receipt,
  LineChart,
  Bell,
  BarChart3,
  Building2,
  Settings,
} from "lucide-react";
import type { IconName } from "./nav-config";

const MAP: Record<IconName, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  transactions: ArrowLeftRight,
  transfers: ArrowRightLeft,
  accounts: Wallet,
  cards: CreditCard,
  categories: Tags,
  family: Users,
  members: UserCircle2,
  crops: Sprout,
  livestock: PawPrint,
  leases: FileSignature,
  workers: HardHat,
  wages: CalendarClock,
  loans: Landmark,
  "card-emi": Receipt,
  investments: LineChart,
  reminders: Bell,
  reports: BarChart3,
  workspace: Building2,
  settings: Settings,
};

export function NavIcon({ name, className }: { name: IconName; className?: string }) {
  const Icon = MAP[name];
  return <Icon className={className} />;
}
