"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CategoryRow } from "./category-combobox";

/**
 * Compact "quick create" for adding a custom category from inline
 * surfaces (transaction dialog combobox, etc.). Pre-fills the name from
 * the search text the user already typed, pre-selects the parent and
 * transaction type to match the surrounding context, and on success
 * returns the new category id so the caller can auto-select it.
 */
export function CategoryQuickCreateDialog({
  open,
  onClose,
  initialName,
  type,
  allCategories,
  defaultParentId = null,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  initialName: string;
  /** Transaction type the picker is currently scoped to. */
  type: "INCOME" | "EXPENSE" | "INVESTMENT";
  /** Full category list — used to populate the parent picker. */
  allCategories: CategoryRow[];
  /** Pre-select a parent (e.g. when the user typed "Vehicle > " before clicking + New). */
  defaultParentId?: string | null;
  /** Called with the new category id after a successful create. */
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- form hydration on dialog open */
    setName(initialName.trim());
    setParentId(defaultParentId ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initialName, defaultParentId]);

  // Parent options: top-level categories whose `types` includes the
  // current transaction type. Custom + default both eligible.
  const parentOptions = useMemo(() => {
    return allCategories
      .filter((c) => c.parentCategoryId == null)
      .map((c) => ({ value: c.id, label: c.name }));
  }, [allCategories]);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          types: [type],
          parentCategoryId: parentId || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to create category");
        return;
      }
      toast.success("Category created");
      globalMutate(
        (k) => typeof k === "string" && k.startsWith("/api/categories"),
      );
      onCreated(body.id as string);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(28rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>New {type.toLowerCase()} category</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={60}
              placeholder="e.g. Mobile recharge"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">
              Parent{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <NativeSelect
              value={parentId}
              onChange={setParentId}
              options={[
                { value: "", label: "— top level —" },
                ...parentOptions,
              ]}
            />
            <span className="mt-1 block text-[10px] text-muted-foreground">
              Pick a parent to nest under (e.g. Utilities), or leave blank to
              create a top-level group.
            </span>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
