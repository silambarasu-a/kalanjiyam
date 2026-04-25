"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { BANKS, type Bank, groupedBanks } from "@/lib/banks";
import { cn } from "@/lib/utils";

/**
 * BankPicker — searchable combobox of Indian banks + NBFCs. The input is
 * the value: typing filters the suggestion list. Picking a suggestion
 * snaps the input to the canonical name. Typing a name that isn't in the
 * curated list is allowed (escape hatch for cooperative / regional banks)
 * — the typed string is stored verbatim.
 *
 * Usage:
 *   <BankPicker value={lender} onChange={setLender} />
 */
export function BankPicker({
  value,
  onChange,
  placeholder = "Search banks…",
  className,
  required,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const allBanks = useMemo(() => BANKS, []);
  const groups = useMemo(() => groupedBanks(), []);
  const knownNames = useMemo(() => new Set(allBanks.map((b) => b.name)), [allBanks]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlighted, setHighlighted] = useState<number>(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mirror externally driven value changes (edit dialog reuses this).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- sync display when parent value changes */
    setQuery(value);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Filtered flat list (used for keyboard nav + render). When the query is
  // empty, show every bank grouped by category. When the query has text,
  // ignore groupings and just rank by substring match.
  const flatFiltered = useMemo<Bank[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...allBanks];
    return allBanks
      .filter((b) => b.name.toLowerCase().includes(q))
      .sort((a, b) => {
        // Prefer banks whose name starts with the query.
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.name.localeCompare(b.name);
      });
  }, [query, allBanks]);

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
        <div className="absolute left-0 right-0 z-50 mt-1 rounded-lg border bg-popover shadow-[var(--shadow-popover)] max-h-72 overflow-y-auto">
          {flatFiltered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              {isFreeText ? (
                <>
                  No matches. Press <kbd className="text-foreground">Enter</kbd> or click
                  outside to keep <strong className="text-foreground">&ldquo;{query}&rdquo;</strong>.
                </>
              ) : (
                "No banks found."
              )}
            </div>
          ) : query.trim() ? (
            // Search mode: flat ranked list.
            <ul className="py-1">
              {flatFiltered.map((b, i) => (
                <BankRow
                  key={b.name}
                  bank={b}
                  selected={value === b.name}
                  highlighted={highlighted === i}
                  onClick={() => commit(b.name)}
                  onMouseEnter={() => setHighlighted(i)}
                />
              ))}
            </ul>
          ) : (
            // Empty query: keep the category groupings.
            <div className="py-1">
              {groups.map((g) => (
                <div key={g.category}>
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                    {g.category}
                  </div>
                  <ul>
                    {g.banks.map((b) => {
                      const flatIdx = flatFiltered.indexOf(b);
                      return (
                        <BankRow
                          key={b.name}
                          bank={b}
                          selected={value === b.name}
                          highlighted={highlighted === flatIdx}
                          onClick={() => commit(b.name)}
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

function BankRow({
  bank,
  selected,
  highlighted,
  onClick,
  onMouseEnter,
}: {
  bank: Bank;
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
        <span className="flex-1 truncate">{bank.name}</span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {bank.category}
        </span>
        {selected && <Check className="h-4 w-4 text-primary" />}
      </button>
    </li>
  );
}
