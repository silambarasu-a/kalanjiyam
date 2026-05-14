"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

/**
 * Searchable hierarchical category picker.
 *
 * Standards:
 *   - Keyboard: Arrow keys / Enter / Esc / Tab handled by cmdk + Radix Popover
 *   - Accessibility: combobox role + aria-expanded provided by PopoverTrigger
 *   - Search: case-insensitive substring match on `Parent > Child`
 *   - Two-level only — children render under their parent
 *   - Selecting a parent is allowed (catch-all)
 *   - Inline create: when canCreate=true, a "+ New category" item appears
 *     at the bottom of the list and calls the supplied onRequestCreate
 *     callback with the current search text
 *
 * Drop-in replacement for a single-select category dropdown:
 *
 *   <CategoryCombobox
 *     value={categoryId}
 *     onChange={setCategoryId}
 *     categories={categories}
 *     placeholder="Pick a category…"
 *   />
 */

export type CategoryRow = {
  id: string;
  name: string;
  parentCategoryId: string | null;
  group?: string | null;
  isDefault?: boolean;
};

export function CategoryCombobox({
  value,
  onChange,
  categories,
  placeholder = "Pick a category…",
  emptyHint,
  disabled,
  canCreate = false,
  onRequestCreate,
  className,
  triggerClassName,
}: {
  value: string | null | undefined;
  onChange: (id: string) => void;
  categories: CategoryRow[];
  placeholder?: string;
  emptyHint?: string;
  disabled?: boolean;
  /** When true, shows a "+ New category" affordance at the bottom. */
  canCreate?: boolean;
  /** Called with the current search text when "+ New" is clicked. */
  onRequestCreate?: (typedText: string) => void;
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Build the flat-tree view: parents first, with their children
  // immediately under them. Orphans (children whose parent isn't in
  // the visible list) are rendered as top-level rows.
  const tree = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const children = new Map<string, CategoryRow[]>();
    const tops: CategoryRow[] = [];
    for (const c of categories) {
      if (c.parentCategoryId && byId.has(c.parentCategoryId)) {
        const list = children.get(c.parentCategoryId) ?? [];
        list.push(c);
        children.set(c.parentCategoryId, list);
      } else {
        tops.push(c);
      }
    }
    tops.sort((a, b) => a.name.localeCompare(b.name));
    for (const list of children.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return { tops, children, byId };
  }, [categories]);

  // Selected category — render the breadcrumb in the trigger button.
  const selected = value ? tree.byId.get(value) : null;
  const selectedLabel = selected
    ? selected.parentCategoryId
      ? `${tree.byId.get(selected.parentCategoryId)?.name ?? "?"} › ${selected.name}`
      : selected.name
    : null;

  // Reset search when popover closes so re-opening starts fresh. The
  // effect is the right place — we're syncing the input's internal
  // state to the popover's open flag.
  useEffect(() => {
    if (!open) {
      /* eslint-disable react-hooks/set-state-in-effect -- reset transient input on close */
      setSearch("");
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open]);

  function handleSelect(id: string) {
    onChange(id);
    setOpen(false);
  }

  // For each parent, decide whether the search string matches the
  // parent itself OR any of its children. This drives both visibility
  // and the value cmdk sees (we use the breadcrumb so substring search
  // works across the parent name + child name).
  const parentMatches = (parent: CategoryRow): boolean => {
    if (!search) return true;
    const q = search.toLowerCase();
    if (parent.name.toLowerCase().includes(q)) return true;
    const kids = tree.children.get(parent.id) ?? [];
    return kids.some((k) => k.name.toLowerCase().includes(q));
  };

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Pick a category"
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              !selectedLabel && "text-muted-foreground",
              triggerClassName,
            )}
          >
            <span className="truncate">{selectedLabel ?? placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        }
      />

      <PopoverContent
        className={cn("w-[min(28rem,calc(100vw-2rem))] p-0", className)}
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search categories…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {emptyHint ?? "No categories match. Try a different word."}
            </CommandEmpty>
            {tree.tops
              .filter((p) => parentMatches(p))
              .map((parent) => {
                const kids = tree.children.get(parent.id) ?? [];
                const visibleKids = search
                  ? kids.filter((k) =>
                      `${parent.name} ${k.name}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                  : kids;
                return (
                  <CommandGroup key={parent.id} heading={parent.name}>
                    {/* Parent itself is selectable as a catch-all. */}
                    <CommandItem
                      value={parent.name + " (parent)"}
                      onSelect={() => handleSelect(parent.id)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === parent.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="font-medium">
                        Use {parent.name} (no subcategory)
                      </span>
                    </CommandItem>
                    {visibleKids.map((child) => (
                      <CommandItem
                        key={child.id}
                        value={`${parent.name} > ${child.name}`}
                        onSelect={() => handleSelect(child.id)}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            value === child.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="text-muted-foreground">
                          {parent.name} ›{" "}
                        </span>
                        <span className="ml-1">{child.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
            {canCreate && onRequestCreate && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value={`__create__${search}`}
                    onSelect={() => {
                      setOpen(false);
                      onRequestCreate(search.trim());
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    <span>
                      {search.trim()
                        ? `Create "${search.trim()}"…`
                        : "New category…"}
                    </span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
