"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { LogOut, Settings } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeCycleItem } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Sidebar bottom pill. Avatar + name/email opens a popover for theme cycling;
 * the right edge holds inline Settings and Sign-out icon buttons. The pill has
 * a Dynamic-Island-style soft elevation against the sidebar surface.
 */
export function UserMenu() {
  const { data: session } = useSession();
  const initials =
    session?.user.name
      ?.split(" ")
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") ?? "?";

  return (
    <div className="flex items-center gap-1 rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)] px-1.5 py-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex flex-1 min-w-0 items-center gap-2.5 rounded-xl px-1.5 py-1 text-left text-sm hover:bg-accent transition-colors">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="truncate font-medium leading-tight">
              {session?.user.name}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {session?.user.email}
            </div>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 p-1.5">
          <ThemeCycleItem />
        </DropdownMenuContent>
      </DropdownMenu>

      <Link
        href="/settings"
        aria-label="Settings"
        className="h-9 w-9 shrink-0 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <Settings className="h-4 w-4" />
      </Link>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/login" })}
        aria-label="Sign out"
        className="h-9 w-9 shrink-0 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
