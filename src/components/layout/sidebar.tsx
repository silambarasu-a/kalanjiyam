"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { getPermission } from "@/lib/permissions";
import { NAV_GROUPS } from "./nav-config";
import { NavIcon } from "./nav-icon";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { UserMenu } from "./user-menu";

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <aside className="hidden md:flex sticky top-3 self-start h-[calc(100vh-1.5rem)] w-64 shrink-0 flex-col bg-sidebar border border-sidebar-border rounded-2xl shadow-[var(--shadow-soft)] overflow-hidden text-sidebar-foreground">
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <span className="h-7 w-1.5 bg-primary rounded-full" />
          <span className="text-base font-semibold tracking-tight">Kalanjiyam</span>
        </div>
      </div>

      <div className="px-3 pb-3">
        <WorkspaceSwitcher />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) =>
            session ? getPermission(session, item.feature) !== "hidden" : true
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label} className="mb-3">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {visibleItems.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors",
                          "hover:bg-accent",
                          active
                            ? "bg-accent text-primary font-medium"
                            : "text-foreground"
                        )}
                      >
                        <NavIcon
                          name={item.icon}
                          className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")}
                        />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <UserMenu />
      </div>
    </aside>
  );
}
