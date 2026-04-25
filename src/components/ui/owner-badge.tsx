"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";
import { Share2, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface OwnerBadgeProps {
  ownerId?: string | null;
  ownerName?: string | null;
  sharedWithIds?: string[];
  resourceType: "account" | "loan" | "investment";
  resourceId: string;
  onShareToggled?: () => void;
}

export function OwnerBadge({
  ownerId,
  ownerName,
  sharedWithIds = [],
  resourceType,
  resourceId,
  onShareToggled,
}: OwnerBadgeProps) {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);

  if (!session?.user) return null;

  const isAdmin = session.user.role === "ADMIN";
  const isOwner = ownerId === session.user.id;
  const isShared = sharedWithIds.includes(session.user.id);

  // Only show owner info if admin (to see whose records are whose)
  // Or if the record is shared with the current user
  if (!isAdmin && !isShared) return null;

  async function handleShareToggle() {
    if (!isAdmin) return;
    setLoading(true);

    // For simplicity in a 2-user household, find the other user
    // The share API needs a target userId — we'll toggle for all non-admin members
    try {
      const res = await fetch("/api/household");
      const household = await res.json();
      const members = household.users?.filter(
        (u: { id: string }) => u.id !== session?.user?.id
      );

      if (!members?.length) {
        toast.error("No other members in household");
        return;
      }

      // Toggle share for each member
      for (const member of members) {
        const isCurrentlyShared = sharedWithIds.includes(member.id);
        await fetch("/api/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resourceType,
            resourceId,
            userId: member.id,
            action: isCurrentlyShared ? "unshare" : "share",
          }),
        });
      }

      toast.success(
        sharedWithIds.length > 0 ? "Unshared" : "Shared with members"
      );
      onShareToggled?.();
    } catch {
      toast.error("Failed to update sharing");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      {isAdmin && !isOwner && ownerName && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          <UserCircle className="h-3 w-3" />
          {ownerName}
        </span>
      )}
      {isShared && !isOwner && (
        <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
          <Share2 className="h-3 w-3" />
          Shared
        </span>
      )}
      {isAdmin && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={handleShareToggle}
          disabled={loading}
          title={sharedWithIds.length > 0 ? "Unshare" : "Share with members"}
        >
          <Share2
            className={`h-3.5 w-3.5 ${
              sharedWithIds.length > 0
                ? "text-blue-600"
                : "text-muted-foreground"
            }`}
          />
        </Button>
      )}
    </span>
  );
}
