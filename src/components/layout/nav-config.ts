import type { Feature } from "@/lib/permissions";

export type NavItem = {
  label: string;
  href: string;
  feature: Feature;
  icon: IconName;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export type IconName =
  | "dashboard"
  | "transactions"
  | "transfers"
  | "accounts"
  | "cards"
  | "categories"
  | "contacts"
  | "members"
  | "crops"
  | "livestock"
  | "leases"
  | "workers"
  | "wages"
  | "loans"
  | "card-emi"
  | "investments"
  | "reminders"
  | "notifications"
  | "reports"
  | "workspace"
  | "settings";

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", href: "/dashboard", feature: "dashboard", icon: "dashboard" }],
  },
  {
    label: "Money",
    items: [
      { label: "Transactions", href: "/transactions", feature: "transactions", icon: "transactions" },
      { label: "Transfers", href: "/transfers", feature: "transfers", icon: "transfers" },
      { label: "Accounts", href: "/accounts", feature: "accounts", icon: "accounts" },
      { label: "Cards", href: "/cards", feature: "cards", icon: "cards" },
      { label: "Categories", href: "/categories", feature: "categories", icon: "categories" },
    ],
  },
  {
    label: "Contacts",
    items: [
      { label: "Contacts", href: "/contacts", feature: "contacts", icon: "contacts" },
    ],
  },
  {
    label: "Farm",
    items: [
      { label: "Overview", href: "/farm", feature: "crops", icon: "crops" },
      { label: "Crops", href: "/crops", feature: "crops", icon: "crops" },
      { label: "Livestock", href: "/livestock", feature: "livestock", icon: "livestock" },
      { label: "Leases", href: "/leases", feature: "leases", icon: "leases" },
      { label: "Workers", href: "/workers", feature: "workers", icon: "workers" },
      { label: "Wages & Attendance", href: "/wages", feature: "wages", icon: "wages" },
    ],
  },
  {
    label: "Debt",
    items: [
      { label: "Bank Loans", href: "/loans/bank", feature: "bank_loans", icon: "loans" },
      { label: "Hand Loans", href: "/loans/hand", feature: "hand_loans", icon: "loans" },
      { label: "Card EMI", href: "/loans/card-emi", feature: "card_emi", icon: "card-emi" },
    ],
  },
  {
    label: "Growth",
    items: [
      { label: "Investments", href: "/investments", feature: "investments", icon: "investments" },
    ],
  },
  {
    label: "Insight",
    items: [
      { label: "Notifications", href: "/notifications", feature: "reminders", icon: "notifications" },
      { label: "Reports", href: "/reports", feature: "reports", icon: "reports" },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Workspace", href: "/workspaces", feature: "workspace", icon: "workspace" },
      { label: "Members & Roles", href: "/settings/members", feature: "members", icon: "members" },
      { label: "Profile", href: "/settings", feature: "settings", icon: "settings" },
    ],
  },
];

export const MOBILE_PRIMARY: { label: string; href: string; icon: IconName; feature: Feature }[] = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard", feature: "dashboard" },
  { label: "Transactions", href: "/transactions", icon: "transactions", feature: "transactions" },
  { label: "Farm", href: "/farm", icon: "crops", feature: "crops" },
];

// Subsections shown as a sticky pill-strip at the top of every Farm page.
// Order is the corporate scan-order: planning → operations → people → money.
export const FARM_SUBSECTIONS: { label: string; href: string; feature: Feature }[] = [
  { label: "Overview", href: "/farm", feature: "crops" },
  { label: "Crops", href: "/crops", feature: "crops" },
  { label: "Livestock", href: "/livestock", feature: "livestock" },
  { label: "Leases", href: "/leases", feature: "leases" },
  { label: "Workers", href: "/workers", feature: "workers" },
  { label: "Wages", href: "/wages", feature: "wages" },
];
