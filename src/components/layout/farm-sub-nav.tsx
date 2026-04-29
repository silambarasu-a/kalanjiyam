"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { getPermission } from "@/lib/permissions";
import { FARM_SUBSECTIONS } from "./nav-config";

/**
 * Persistent lateral nav across Farm subsections (Overview / Crops /
 * Livestock / Leases / Workers / Wages). Rendered at the top of every
 * Farm page so users can hop sideways without bouncing through the
 * sidebar. Permission-aware — hides tabs the user can't see.
 */
export function FarmSubNav() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const visible = FARM_SUBSECTIONS.filter((s) =>
    session ? getPermission(session, s.feature) !== "hidden" : true,
  );

  // Longest-match — /farm/anything beats /farm Overview.
  const activeHref = (() => {
    let best: string | null = null;
    for (const s of visible) {
      if (pathname === s.href || pathname.startsWith(s.href + "/")) {
        if (!best || s.href.length > best.length) best = s.href;
      }
    }
    return best;
  })();

  if (visible.length <= 1) return null;

  return (
    <nav
      aria-label="Farm sections"
      className="-mx-1 flex flex-nowrap gap-1 overflow-x-auto pb-1 scrollbar-none"
    >
      {visible.map((s) => {
        const active = s.href === activeHref;
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
