"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  INSURERS,
  type Insurer,
  type InsurerCategory,
  groupedInsurers,
} from "@/lib/insurers";
import { cn } from "@/lib/utils";

/**
 * InsurerPicker — searchable combobox of common Indian insurance
 * providers. Same UX as BankPicker: typing filters the list, picking a
 * suggestion snaps the input to the canonical name, and free-text is
 * preserved as an escape hatch for niche or regional insurers.
 *
 * Usage:
 *   <InsurerPicker value={name} onChange={setName} />
 */
export function InsurerPicker({
  value,
  onChange,
  placeholder = "Search insurers…",
  className,
  required,
  autoFocus,
  filterCategories,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  autoFocus?: boolean;
  /** When provided, only insurers whose category is in this set are
   * suggested. The free-text fallback still works for niche names. */
  filterCategories?: InsurerCategory[];
}) {
  const all = useMemo(() => {
    if (!filterCategories || filterCategories.length === 0) return INSURERS;
    const allowed = new Set(filterCategories);
    // An insurer matches if any of its categories overlaps the filter —
    // covers HDFC ERGO General qualifying for a Health policy etc.
    return INSURERS.filter((i) => i.categories.some((c) => allowed.has(c)));
  }, [filterCategories]);
  const groups = useMemo(
    () => groupedInsurers(filterCategories),
    [filterCategories],
  );
  const knownNames = useMemo(() => new Set(all.map((i) => i.name)), [all]);

  // Pick the badge category for a row: when filtering, prefer a
  // category that matches the filter (so HDFC ERGO shows "Health" when
  // the user picked Health). Otherwise show the primary category.
  function badgeCategory(ins: Insurer): InsurerCategory {
    if (filterCategories && filterCategories.length > 0) {
      const allowed = new Set(filterCategories);
      const match = ins.categories.find((c) => allowed.has(c));
      if (match) return match;
    }
    return ins.categories[0];
  }

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlighted, setHighlighted] = useState<number>(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- sync display when parent value changes */
    setQuery(value);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const flatFiltered = useMemo<Insurer[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...all];
    return all
      .filter((b) => b.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.name.localeCompare(b.name);
      });
  }, [query, all]);

  function commit(name: string) {
    onChange(name);
    setQuery(name);
    setOpen(false);
    setHighlighted(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlighted((h) => Math.min(flatFiltered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      if (open && highlighted >= 0 && flatFiltered[highlighted]) {
        e.preventDefault();
        commit(flatFiltered[highlighted].name);
      } else {
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
    }
  }

  const isFreeText = query !== "" && !knownNames.has(query);

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          required={required}
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            onChange(next);
            setOpen(true);
            setHighlighted(0);
          }}
          onKeyDown={onKeyDown}
          className="flex h-9 w-full rounded-lg border border-input bg-transparent pl-8 pr-9 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30 placeholder:text-muted-foreground"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label="Toggle suggestions"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 rounded-lg border bg-popover shadow-(--shadow-popover) max-h-72 overflow-y-auto">
          {flatFiltered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              {isFreeText ? (
                <>
                  No matches. Press <kbd className="text-foreground">Enter</kbd> or click
                  outside to keep <strong className="text-foreground">&ldquo;{query}&rdquo;</strong>.
                </>
              ) : (
                "No insurers found."
              )}
            </div>
          ) : query.trim() ? (
            <ul className="py-1">
              {flatFiltered.map((ins, i) => (
                <InsurerRow
                  key={ins.name}
                  insurer={ins}
                  badge={badgeCategory(ins)}
                  selected={value === ins.name}
                  highlighted={highlighted === i}
                  onClick={() => commit(ins.name)}
                  onMouseEnter={() => setHighlighted(i)}
                />
              ))}
            </ul>
          ) : (
            <div className="py-1">
              {groups.map((g) => (
                <div key={g.category}>
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                    {g.category}
                  </div>
                  <ul>
                    {g.insurers.map((ins) => {
                      const flatIdx = flatFiltered.indexOf(ins);
                      return (
                        <InsurerRow
                          key={ins.name}
                          insurer={ins}
                          badge={badgeCategory(ins)}
                          selected={value === ins.name}
                          highlighted={highlighted === flatIdx}
                          onClick={() => commit(ins.name)}
                          onMouseEnter={() => setHighlighted(flatIdx)}
                        />
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {!open && isFreeText && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Using custom name <strong className="text-foreground">&ldquo;{query}&rdquo;</strong>
        </p>
      )}
    </div>
  );
}

function InsurerRow({
  insurer,
  badge,
  selected,
  highlighted,
  onClick,
  onMouseEnter,
}: {
  insurer: Insurer;
  badge: InsurerCategory;
  selected: boolean;
  highlighted: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left",
          highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
        )}
      >
        <span className="flex-1 truncate">{insurer.name}</span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {badge}
        </span>
        {selected && <Check className="h-4 w-4 text-primary" />}
      </button>
    </li>
  );
}
