"use client";

import { useSession, signOut } from "next-auth/react";
import { LogOut, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function UserMenu() {
  const { data: session } = useSession();
  const initials =
    session?.user.name
      ?.split(" ")
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") ?? "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="w-full flex items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-white/5">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-[var(--brand-orange)] text-white text-xs">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="truncate text-white/90">{session?.user.name}</div>
          <div className="truncate text-xs text-white/50">{session?.user.email}</div>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => (window.location.href = "/settings")}>
          <User className="h-4 w-4 mr-2" /> Profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>
          <LogOut className="h-4 w-4 mr-2" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
