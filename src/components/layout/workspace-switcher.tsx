"use client";

import { useState } from "react";
import { ChevronsUpDown, Check, Building2 } from "lucide-react";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type WorkspaceRow = {
  id: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "SUPER_ADMIN";
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function WorkspaceSwitcher() {
  const { data: session, update } = useSession();
  const { data: list } = useSWR<{ workspaces: WorkspaceRow[] }>(
    "/api/workspaces",
    fetcher,
    { revalidateOnFocus: false }
  );
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  const activeId = session?.user.activeWorkspaceId ?? null;
  const workspaces = list?.workspaces ?? [];
  const active = workspaces.find((w) => w.id === activeId);

  async function switchTo(id: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setSwitching(id);
    try {
      await fetch(`/api/workspaces/${id}/switch`, { method: "POST" });
      await update({ switchWorkspace: id });
      window.location.reload();
    } catch {
      setSwitching(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "w-full flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm",
          "bg-[var(--sidebar-accent)] text-white/90 hover:bg-white/10"
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Building2 className="h-4 w-4 shrink-0" />
          <span className="truncate">{active?.name ?? "No workspace"}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 text-white/60 shrink-0" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Your workspaces ({workspaces.length} / 3)
        </div>
        {workspaces.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => switchTo(w.id)}
            disabled={switching !== null}
            className={cn(
              "w-full flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm",
              "hover:bg-accent/50 disabled:opacity-50"
            )}
          >
            <span className="flex items-center gap-2 min-w-0">
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{w.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {w.role}
              </span>
            </span>
            {w.id === activeId && <Check className="h-4 w-4 text-[var(--brand-orange)]" />}
          </button>
        ))}
        {workspaces.length === 0 && (
          <div className="px-2 py-2 text-sm text-muted-foreground">
            No workspaces yet.
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
