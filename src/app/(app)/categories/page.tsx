"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";

type Category = {
  id: string;
  name: string;
  types: ("INCOME" | "EXPENSE" | "INVESTMENT" | "HAND_LOAN" | "TRANSFER")[];
  group: string | null;
  icon: string | null;
  isDefault: boolean;
  custom: boolean;
  parentCategoryId: string | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const TYPES = [
  { value: "INCOME", label: "Income" },
  { value: "EXPENSE", label: "Expense" },
  { value: "INVESTMENT", label: "Investment" },
] as const;

type TypeKey = "INCOME" | "EXPENSE" | "INVESTMENT";

export default function CategoriesPage() {
  const { data, isLoading } = useSWR<{ categories: Category[] }>(
    "/api/categories",
    fetcher,
  );
  const [editOpen, setEditOpen] = useState<Category | "new" | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const categories = useMemo(() => data?.categories ?? [], [data]);

  // Bucket by transaction type, then build a parent → children map.
  const byType = useMemo(() => {
    const buckets: Record<TypeKey, { parents: Category[]; childrenOf: Map<string, Category[]> }> = {
      INCOME: { parents: [], childrenOf: new Map() },
      EXPENSE: { parents: [], childrenOf: new Map() },
      INVESTMENT: { parents: [], childrenOf: new Map() },
    };
    for (const c of categories) {
      for (const type of c.types as TypeKey[]) {
        if (type !== "INCOME" && type !== "EXPENSE" && type !== "INVESTMENT") continue;
        const bucket = buckets[type];
        if (c.parentCategoryId == null) {
          bucket.parents.push(c);
        } else {
          const list = bucket.childrenOf.get(c.parentCategoryId) ?? [];
          list.push(c);
          bucket.childrenOf.set(c.parentCategoryId, list);
        }
      }
    }
    for (const k of Object.keys(buckets) as TypeKey[]) {
      buckets[k].parents.sort((a, b) => a.name.localeCompare(b.name));
      for (const list of buckets[k].childrenOf.values()) {
        list.sort((a, b) => a.name.localeCompare(b.name));
      }
    }
    return buckets;
  }, [categories]);

  function toggle(id: string) {
    setCollapsed((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete(c: Category) {
    if (!confirm(`Delete "${c.name}"?`)) return;
    const res = await fetch(`/api/categories/${c.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Failed to delete category");
      return;
    }
    toast.success("Category deleted");
    globalMutate("/api/categories");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Two-level hierarchy — parents group related subcategories. Defaults
            ship with the app and can&apos;t be edited; add your own to suit how
            you track money.
          </p>
        </div>
        <Button onClick={() => setEditOpen("new")} className="gap-2">
          <Plus className="h-4 w-4" /> New category
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="space-y-8">
        {(Object.entries(byType) as [TypeKey, (typeof byType)[TypeKey]][]).map(
          ([type, bucket]) => (
            <section key={type}>
              <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
                {type === "INCOME"
                  ? "Income"
                  : type === "EXPENSE"
                    ? "Expense"
                    : "Investment"}
              </h2>
              {bucket.parents.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No top-level categories for {type.toLowerCase()} yet.
                </p>
              ) : (
                <div className="rounded-lg border bg-card divide-y">
                  {bucket.parents.map((parent) => {
                    const kids = bucket.childrenOf.get(parent.id) ?? [];
                    const isCollapsed = collapsed.has(parent.id);
                    return (
                      <div key={parent.id}>
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          {kids.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => toggle(parent.id)}
                              aria-label={isCollapsed ? "Expand" : "Collapse"}
                              className="rounded p-0.5 hover:bg-muted"
                            >
                              {isCollapsed ? (
                                <ChevronRight className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                            </button>
                          ) : (
                            <span className="w-4" />
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold truncate">
                              {parent.name}
                            </span>
                            {kids.length > 0 && (
                              <span className="ml-2 text-[10px] text-muted-foreground">
                                {kids.length} subcategor
                                {kids.length === 1 ? "y" : "ies"}
                              </span>
                            )}
                            {parent.isDefault && !parent.custom && (
                              <span className="ml-2 inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                Default
                              </span>
                            )}
                          </div>
                          {parent.custom && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditOpen(parent)}
                                aria-label={`Edit ${parent.name}`}
                                title="Edit"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(parent)}
                                aria-label={`Delete ${parent.name}`}
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                        {!isCollapsed &&
                          kids.map((child) => (
                            <div
                              key={child.id}
                              className="flex items-center gap-2 px-3 py-2 pl-10 border-t bg-muted/20"
                            >
                              <div className="flex-1 min-w-0">
                                <span className="text-sm truncate">
                                  {child.name}
                                </span>
                                {child.isDefault && !child.custom && (
                                  <span className="ml-2 inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    Default
                                  </span>
                                )}
                              </div>
                              {child.custom && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setEditOpen(child)}
                                    aria-label={`Edit ${child.name}`}
                                    title="Edit"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDelete(child)}
                                    aria-label={`Delete ${child.name}`}
                                    title="Delete"
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </>
                              )}
                            </div>
                          ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ),
        )}
      </div>

      <CategoryDialog
        category={editOpen === "new" ? null : (editOpen as Category | null)}
        allCategories={categories}
        open={editOpen !== null}
        onClose={() => setEditOpen(null)}
      />
    </div>
  );
}

function CategoryDialog({
  category,
  allCategories,
  open,
  onClose,
}: {
  category: Category | null;
  allCategories: Category[];
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [types, setTypes] = useState<string[]>(["EXPENSE"]);
  const [parentCategoryId, setParentCategoryId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form state on dialog open. */
    setName(category?.name ?? "");
    setGroup(category?.group ?? "");
    setTypes(category?.types ?? ["EXPENSE"]);
    setParentCategoryId(category?.parentCategoryId ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, category]);

  // Parents available for selection: top-level categories whose `types`
  // is a superset of the chosen types. Exclude the row being edited.
  const parentOptions = useMemo(() => {
    return allCategories
      .filter((c) => c.parentCategoryId == null)
      .filter((c) => (category ? c.id !== category.id : true))
      .filter((c) => types.every((t) => c.types.includes(t as never)))
      .map((c) => ({ value: c.id, label: c.name }));
  }, [allCategories, types, category]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name,
        group: group.trim() || undefined,
        types,
        parentCategoryId: parentCategoryId || null,
      };
      const res = await fetch(
        category ? `/api/categories/${category.id}` : "/api/categories",
        {
          method: category ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
      } else {
        toast.success(category ? "Category updated" : "Category created");
        globalMutate("/api/categories");
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? "Edit category" : "New category"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={60}
            />
          </label>
          <div>
            <span className="text-xs font-medium block mb-2">Applies to</span>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((t) => (
                <Button
                  key={t.value}
                  type="button"
                  variant={types.includes(t.value) ? "default" : "outline"}
                  onClick={() =>
                    setTypes((curr) =>
                      curr.includes(t.value)
                        ? curr.filter((x) => x !== t.value)
                        : [...curr, t.value]
                    )
                  }
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium">
              Parent category{" "}
              <span className="font-normal text-muted-foreground">
                (optional — leave blank to create a top-level group)
              </span>
            </span>
            <NativeSelect
              value={parentCategoryId}
              onChange={(v) => setParentCategoryId(v)}
              options={[
                { value: "", label: "— top level —" },
                ...parentOptions,
              ]}
            />
            {parentOptions.length === 0 && types.length > 0 && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                No top-level parent supports the chosen type
                {types.length === 1 ? "" : "s"}. This category will be top-level.
              </p>
            )}
          </label>
          <label className="block">
            <span className="text-xs font-medium">
              Legacy group label{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </span>
            <Input
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder="e.g. Expense, Income, Investment"
              maxLength={40}
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !name.trim() || types.length === 0}
          >
            {category ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
