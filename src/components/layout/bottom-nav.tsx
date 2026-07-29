"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Plus, Menu } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { getPermission, isFarmFeature, type Feature } from "@/lib/permissions";
import { MOBILE_PRIMARY, NAV_GROUPS } from "./nav-config";
import { NavIcon } from "./nav-icon";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { useTransactionDialog } from "@/contexts/transaction-dialog";

export function BottomNav() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const { openDialog } = useTransactionDialog();
  const [moreOpen, setMoreOpen] = useState(false);

  // `useSession()` hands back data:null while it resolves, so treating "no
  // session" as "show everything" flashed the Farm entries on every hard load
  // of a farm-off workspace. Non-farm entries stay optimistic during that
  // window (the server is the real gate) so the bar doesn't render empty;
  // farm entries wait until we actually know whether the module is on.
  const canSee = (feature: Feature) =>
    status === "loading"
      ? !isFarmFeature(feature)
      : getPermission(session, feature) !== "hidden";

  const primary = MOBILE_PRIMARY.filter((item) => canSee(item.feature));

  // The bar is [links…][FAB][links…][More] in equal-width columns, so the FAB
  // only sits centred when the cell counts either side match: split the
  // surviving links down the middle ("More" being the last right-hand cell)
  // and size the grid to what survived. A hardcoded 5 columns strands an empty
  // one the moment a link is filtered out. With an even number of links the
  // halves differ by one cell and the FAB lands half a column off centre —
  // still better than a dead column, and the links stay evenly spaced.
  const leftCount = Math.ceil(primary.length / 2);

  // Longest-match active href across the full nav so e.g. /settings/members
  // doesn't also light up /settings (Profile) — same logic as the sidebar.
  const moreActiveHref = (() => {
    let best: string | null = null;
    for (const g of NAV_GROUPS) {
      for (const i of g.items) {
        if (pathname === i.href || pathname.startsWith(i.href + "/")) {
          if (!best || i.href.length > best.length) best = i.href;
        }
      }
    }
    return best;
  })();

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary"
      >
        <ul
          className="grid h-14"
          style={{
            gridTemplateColumns: `repeat(${primary.length + 2}, minmax(0, 1fr))`,
          }}
        >
          {primary.slice(0, leftCount).map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "h-full flex flex-col items-center justify-center gap-0.5 text-[10px]",
                    active ? "text-primary" : "text-muted-foreground"
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
              className="h-11 w-11 rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/20 flex items-center justify-center -mt-5 hover:bg-brand-primary-soft transition-colors"
            >
              <Plus className="h-5 w-5" />
            </button>
          </li>
          {primary.slice(leftCount).map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "h-full flex flex-col items-center justify-center gap-0.5 text-[10px]",
                    active ? "text-primary" : "text-muted-foreground"
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
              <SheetTrigger className="h-full w-full flex flex-col items-center justify-center gap-0.5 text-[10px] text-muted-foreground">
                <Menu className="h-5 w-5" />
                <span>More</span>
              </SheetTrigger>
              <SheetContent side="right" className="w-80">
                <SheetHeader>
                  <SheetTitle>Menu</SheetTitle>
                </SheetHeader>
                <div className="space-y-4">
                  <WorkspaceSwitcher />
                  {NAV_GROUPS.map((group) => {
                    const visible = group.items.filter((i) => canSee(i.feature));
                    if (visible.length === 0) return null;
                    return (
                      <div key={group.label}>
                        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          {group.label}
                        </div>
                        <ul className="space-y-0.5">
                          {visible.map((item) => {
                            const active = item.href === moreActiveHref;
                            return (
                              <li key={item.href}>
                                <Link
                                  href={item.href}
                                  onClick={() => setMoreOpen(false)}
                                  className={cn(
                                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm",
                                    active
                                      ? "bg-accent text-primary font-medium"
                                      : "text-foreground hover:bg-accent"
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
                <SheetFooter className="sm:justify-start">
                  <button
                    type="button"
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="text-left text-sm text-destructive hover:underline"
                  >
                    Sign out
                  </button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </li>
        </ul>
      </nav>
      <div className="md:hidden h-14" aria-hidden="true" />
    </>
  );
}
