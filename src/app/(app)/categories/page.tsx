"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Category = {
  id: string;
  name: string;
  types: ("INCOME" | "EXPENSE" | "INVESTMENT" | "HAND_LOAN" | "TRANSFER")[];
  group: string | null;
  icon: string | null;
  isDefault: boolean;
  custom: boolean;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const TYPES = [
  { value: "INCOME", label: "Income" },
  { value: "EXPENSE", label: "Expense" },
  { value: "INVESTMENT", label: "Investment" },
] as const;

export default function CategoriesPage() {
  const { data, isLoading } = useSWR<{ categories: Category[] }>("/api/categories", fetcher);
  const [editOpen, setEditOpen] = useState<Category | "new" | null>(null);

  const byGroup: Record<string, Category[]> = {};
  for (const c of data?.categories ?? []) {
    const g = c.group ?? "Other";
    (byGroup[g] ??= []).push(c);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Defaults ship with the app. Add your own to suit how you track money.
          </p>
        </div>
        <Button onClick={() => setEditOpen("new")} className="gap-2">
          <Plus className="h-4 w-4" /> New category
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="space-y-6">
        {Object.entries(byGroup).map(([group, cats]) => (
          <section key={group}>
            <h2 className="text-sm font-semibold mb-2">{group}</h2>
            <div className="rounded-lg border bg-card divide-y">
              {cats.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium truncate">{c.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {c.types.join(", ")}
                    </span>
                    {c.isDefault && !c.custom && (
                      <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                        default
                      </span>
                    )}
                  </div>
                  {c.custom && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditOpen(c)}
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async () => {
                          if (!confirm(`Delete "${c.name}"?`)) return;
                          await fetch(`/api/categories/${c.id}`, { method: "DELETE" });
                          globalMutate("/api/categories");
                        }}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <CategoryDialog
        category={editOpen === "new" ? null : (editOpen as Category | null)}
        open={editOpen !== null}
        onClose={() => setEditOpen(null)}
      />
    </div>
  );
}

function CategoryDialog({
  category,
  open,
  onClose,
}: {
  category: Category | null;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [types, setTypes] = useState<string[]>(["EXPENSE"]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form state on dialog open. */
    setName(category?.name ?? "");
    setGroup(category?.group ?? "");
    setTypes(category?.types ?? ["EXPENSE"]);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, category]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name,
        group: group.trim() || undefined,
        types,
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
      if (!res.ok) setError(body.error ?? "Failed");
      else {
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
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Group (optional)</span>
            <Input
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder="e.g. Expense, Income, Investment"
              maxLength={40}
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
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name.trim() || types.length === 0}>
            {category ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
