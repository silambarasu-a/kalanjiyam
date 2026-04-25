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
    <header className="hidden md:flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <h1 className="text-base font-semibold text-foreground">{title}</h1>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => openDialog("EXPENSE")}
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-[var(--brand-primary-soft)] transition-colors"
        >
          <Plus className="h-4 w-4" /> New
        </button>
        <button
          type="button"
          className="h-9 w-9 rounded-md hover:bg-accent flex items-center justify-center text-muted-foreground transition-colors"
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
    <header className="md:hidden h-14 flex items-center justify-between border-b border-border bg-card px-4">
      <span className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground">
        <span className="h-4 w-1 bg-primary rounded-full" />
        Kalanjiyam
      </span>
      <span className="text-sm font-medium text-muted-foreground">{title}</span>
      <span className="w-16" />
    </header>
  );
}
