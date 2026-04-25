"use client";

import { usePathname } from "next/navigation";
import { Bell, Plus } from "lucide-react";
import { NAV_GROUPS } from "./nav-config";
import { useTransactionDialog } from "@/contexts/transaction-dialog";

function findTitle(pathname: string): string {
  for (const g of NAV_GROUPS) {
    for (const i of g.items) {
      if (pathname === i.href || pathname.startsWith(i.href + "/")) return i.label;
    }
  }
  return "";
}

export function Header() {
  const pathname = usePathname();
  const title = findTitle(pathname);
  const { openDialog } = useTransactionDialog();

  return (
    <header className="hidden md:flex h-16 items-center justify-between border-b bg-white px-6">
      <h1 className="text-base font-semibold text-foreground">{title}</h1>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => openDialog("EXPENSE")}
          className="rounded-md bg-[var(--brand-orange)] text-white px-3 py-1.5 text-sm font-medium flex items-center gap-1 hover:bg-[var(--brand-orange-light)]"
        >
          <Plus className="h-4 w-4" /> New
        </button>
        <button
          type="button"
          className="h-9 w-9 rounded-md hover:bg-accent flex items-center justify-center text-muted-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

export function MobileHeader() {
  const pathname = usePathname();
  const title = findTitle(pathname);
  return (
    <header className="md:hidden h-14 flex items-center justify-between border-b bg-white px-4">
      <span className="text-xs font-bold tracking-widest text-[var(--brand-navy)]">
        KALANJIYAM
      </span>
      <span className="text-sm font-medium">{title}</span>
      <span className="w-16" />
    </header>
  );
}
