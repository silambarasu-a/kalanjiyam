"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Plus, Menu } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { getPermission } from "@/lib/permissions";
import { MOBILE_PRIMARY, NAV_GROUPS } from "./nav-config";
import { NavIcon } from "./nav-icon";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { useTransactionDialog } from "@/contexts/transaction-dialog";

export function BottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { openDialog } = useTransactionDialog();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary"
      >
        <ul className="grid grid-cols-5 h-14">
          {MOBILE_PRIMARY.slice(0, 2).map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "h-full flex flex-col items-center justify-center gap-0.5 text-[10px]",
                    active ? "text-[var(--brand-maroon)]" : "text-neutral-500"
                  )}
                >
                  <NavIcon name={item.icon} className="h-5 w-5" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => openDialog("EXPENSE")}
              aria-label="New transaction"
              className="h-11 w-11 rounded-full bg-[var(--brand-orange)] text-white shadow-lg shadow-black/20 flex items-center justify-center -mt-5"
            >
              <Plus className="h-5 w-5" />
            </button>
          </li>
          {MOBILE_PRIMARY.slice(2).map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "h-full flex flex-col items-center justify-center gap-0.5 text-[10px]",
                    active ? "text-[var(--brand-maroon)]" : "text-neutral-500"
                  )}
                >
                  <NavIcon name={item.icon} className="h-5 w-5" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger className="h-full w-full flex flex-col items-center justify-center gap-0.5 text-[10px] text-neutral-500">
                <Menu className="h-5 w-5" />
                <span>More</span>
              </SheetTrigger>
              <SheetContent side="right" className="w-80 p-0 flex flex-col">
                <SheetHeader className="px-5 pt-5 pb-3 border-b">
                  <SheetTitle>Menu</SheetTitle>
                </SheetHeader>
                <div className="px-4 py-3 border-b">
                  <WorkspaceSwitcher />
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-3">
                  {NAV_GROUPS.map((group) => {
                    const visible = group.items.filter((i) =>
                      session ? getPermission(session, i.feature) !== "hidden" : true
                    );
                    if (visible.length === 0) return null;
                    return (
                      <div key={group.label} className="mb-4">
                        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          {group.label}
                        </div>
                        <ul className="space-y-0.5">
                          {visible.map((item) => {
                            const active =
                              pathname === item.href ||
                              pathname.startsWith(item.href + "/");
                            return (
                              <li key={item.href}>
                                <Link
                                  href={item.href}
                                  onClick={() => setMoreOpen(false)}
                                  className={cn(
                                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm",
                                    active
                                      ? "bg-accent text-[var(--brand-maroon)]"
                                      : "text-foreground hover:bg-accent/60"
                                  )}
                                >
                                  <NavIcon name={item.icon} className="h-4 w-4" />
                                  <span>{item.label}</span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="border-t px-5 py-3 text-left text-sm text-destructive hover:bg-accent/50"
                >
                  Sign out
                </button>
              </SheetContent>
            </Sheet>
          </li>
        </ul>
      </nav>
      <div className="md:hidden h-14" aria-hidden="true" />
    </>
  );
}
