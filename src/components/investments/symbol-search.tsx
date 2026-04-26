"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, RefreshCw, Search } from "lucide-react";
import type { SymbolSearchResult } from "@/app/api/market/search/route";
import { cn } from "@/lib/utils";

const EXCHANGE_COLORS: Record<string, string> = {
  NSE: "bg-emerald-100 text-emerald-800",
  BSE: "bg-orange-100 text-orange-800",
  NASDAQ: "bg-blue-100 text-blue-800",
  NYSE: "bg-indigo-100 text-indigo-800",
};

interface Props {
  /** Selected symbol (e.g. RELIANCE.NS). */
  value: string;
  /** Selected name — shown as ghost text once a pick is made. */
  name?: string;
  onChange: (symbol: string, name: string, exchange: string) => void;
  required?: boolean;
  placeholder?: string;
  showHint?: boolean;
  autoFocus?: boolean;
}

/**
 * Yahoo Finance autocomplete. Type a name or ticker → debounced search →
 * portaled dropdown of matches → picking one fires `onChange(symbol, name,
 * exchange)`. The popover is rendered via createPortal with position: fixed
 * so it isn't clipped by overflow ancestors (dialogs, tables, etc.).
 */
export function SymbolSearch({
  value,
  name,
  onChange,
  required,
  placeholder,
  showHint = true,
  autoFocus,
}: Props) {
  const [query, setQuery] = useState(value || "");
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirror externally driven value so editing dialogs work.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- sync display when parent value changes */
    setQuery(value || "");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [value]);

  // Outside-click close (works for both wrap + portaled menu).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Position the portaled menu under the input.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setMenuRect({ top: r.bottom, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  function handleInput(raw: string) {
    const upper = raw.toUpperCase();
    setQuery(upper);
    setHighlighted(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (upper.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    setOpen(true);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/market/search?q=${encodeURIComponent(upper)}`);
        const data = (await res.json()) as SymbolSearchResult[] | { error: string };
        setResults(Array.isArray(data) ? data : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  function select(r: SymbolSearchResult) {
    setQuery(r.symbol);
    setOpen(false);
    setResults([]);
    onChange(r.symbol, r.name, r.exchange);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      const pick = results[highlighted];
      if (pick) {
        e.preventDefault();
        select(pick);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          placeholder={placeholder ?? "e.g. Reliance / AAPL / RELIANCE.NS"}
          required={required}
          className="flex h-9 w-full rounded-lg border border-input bg-transparent pl-8 pr-9 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30 placeholder:text-muted-foreground"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {name && value && !query.startsWith("__") && (
        <p className="mt-1 text-[11px] text-muted-foreground truncate">
          Selected: <span className="font-medium text-foreground">{name}</span>
        </p>
      )}
      {showHint && !value && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Indian stocks: append <code className="font-mono">.NS</code> (NSE) or{" "}
          <code className="font-mono">.BO</code> (BSE).
        </p>
      )}

      {open && menuRect && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={{
                position: "fixed",
                top: menuRect.top + 4,
                left: menuRect.left,
                minWidth: menuRect.width,
                maxWidth: `min(34rem, calc(100vw - ${menuRect.left + 8}px))`,
              }}
              className="z-50 max-h-72 overflow-y-auto rounded-lg border bg-popover shadow-(--shadow-popover)"
            >
              {loading && results.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground inline-flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Searching…
                </p>
              ) : results.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">
                  {query ? "No matches." : "Type a company name or ticker."}
                </p>
              ) : (
                <ul className="py-1">
                  {results.map((r, i) => {
                    const exColor =
                      EXCHANGE_COLORS[r.exchangeDisplay] ?? "bg-muted text-muted-foreground";
                    return (
                      <li key={`${r.symbol}-${r.exchange}`}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => select(r)}
                          onMouseEnter={() => setHighlighted(i)}
                          className={cn(
                            "flex w-full items-start gap-3 px-3 py-2 text-sm text-left",
                            i === highlighted
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-accent/50",
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-xs font-semibold uppercase">
                              {r.symbol}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                              {r.name}
                            </div>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              exColor,
                            )}
                          >
                            {r.exchangeDisplay || r.exchange}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
