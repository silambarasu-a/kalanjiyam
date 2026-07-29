"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Plus } from "lucide-react";
import { NotificationsPopover } from "./notifications-popover";
import { useSession, signOut } from "next-auth/react";
import type { Session } from "next-auth";
import { getPermission, isFarmFeature } from "@/lib/permissions";
import { NAV_GROUPS } from "./nav-config";
import { useTransactionDialog } from "@/contexts/transaction-dialog";
import { SessionTimer } from "@/components/session-timer";

/**
 * Title of the nav entry that owns this path — skipping entries the user
 * can't see, so a deep link to a hidden route (a farm page in a workspace
 * that runs no farm) doesn't announce "Crops" in the header.
 *
 * `loading` is the `useSession()` window where the session is still null:
 * non-farm titles render optimistically then, farm titles don't, because we
 * don't yet know whether the farm module is off.
 */
function findTitle(pathname: string, session: Session | null, loading: boolean): string {
  for (const g of NAV_GROUPS) {
    for (const i of g.items) {
      if (pathname !== i.href && !pathname.startsWith(i.href + "/")) continue;
      const visible = loading
        ? !isFarmFeature(i.feature)
        : getPermission(session, i.feature) !== "hidden";
      if (visible) return i.label;
    }
  }
  return "";
}

function formatLastLogin(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function lastLoginExact(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export function Header() {
  const pathname = usePathname();
  const { openDialog } = useTransactionDialog();
  const { data: session, status } = useSession();
  const title = findTitle(pathname, session, status === "loading");

  const firstName = session?.user.name?.split(" ")[0] ?? null;
  const relLogin = formatLastLogin(session?.user.lastLoginAt ?? null);
  const exactLogin = lastLoginExact(session?.user.lastLoginAt ?? null);

  return (
    <header className="hidden md:flex h-16 items-center justify-between border-b border-border bg-card px-6 gap-4">
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold text-foreground">{title}</h1>
          {firstName && (
            <span className="text-xs text-muted-foreground">
              · Welcome,{" "}
              <span className="font-medium text-foreground">{firstName}</span>
            </span>
          )}
        </div>
        {relLogin && (
          <p className="text-[11px] text-muted-foreground" title={exactLogin}>
            Last sign-in {relLogin}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <SessionTimer />
        <button
          type="button"
          onClick={() => openDialog("EXPENSE")}
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-brand-primary-soft transition-colors"
        >
          <Plus className="h-4 w-4" /> New
        </button>
        <NotificationsPopover />
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="h-9 w-9 rounded-md hover:bg-destructive/10 hover:text-destructive flex items-center justify-center text-muted-foreground transition-colors"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

export function MobileHeader() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const title = findTitle(pathname, session, status === "loading");
  const relLogin = formatLastLogin(session?.user.lastLoginAt ?? null);

  return (
    <header className="md:hidden border-b border-border bg-card px-4 py-2 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-5 w-5" />
          Kalanjiyam
        </Link>
        <span className="text-sm font-medium text-muted-foreground truncate flex-1 text-center min-w-0">
          {title}
        </span>
        <SessionTimer />
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="h-8 w-8 shrink-0 rounded-md hover:bg-destructive/10 hover:text-destructive flex items-center justify-center text-muted-foreground transition-colors"
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
      {relLogin && (
        <div className="text-[10px] text-muted-foreground text-center">
          Welcome, {session?.user.name?.split(" ")[0]} · last sign-in {relLogin}
        </div>
      )}
    </header>
  );
}
