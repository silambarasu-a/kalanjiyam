"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { RefreshCw } from "lucide-react";
import type { SymbolSearchResult } from "@/app/api/market/search/route";

const EXCHANGE_COLORS_INLINE: Record<string, string> = {
  NSE: "bg-emerald-100 text-emerald-800",
  BSE: "bg-orange-100 text-orange-800",
  NASDAQ: "bg-blue-100 text-blue-800",
  NYSE: "bg-indigo-100 text-indigo-800",
};

interface SymbolSearchProps {
  value: string;
  onChange: (symbol: string, name: string, exchange: string) => void;
  required?: boolean;
  placeholder?: string;
  showHint?: boolean;
}

export function SymbolSearch({
  value,
  onChange,
  required,
  placeholder,
  showHint = true,
}: SymbolSearchProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/market/search?q=${encodeURIComponent(upper)}`);
        const data: SymbolSearchResult[] = await res.json();
        setResults(data);
        setOpen(data.length > 0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function select(r: SymbolSearchResult) {
    setQuery(r.symbol);
    setOpen(false);
    setResults([]);
    onChange(r.symbol, r.name, r.exchange);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[highlighted]) select(results[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder ?? "e.g. RELIANCE.NS / AAPL"}
          required={required}
          autoComplete="off"
          className="pr-7"
        />
        {loading && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg max-h-60 overflow-y-auto">
          {results.map((r, i) => {
            const exColor =
              EXCHANGE_COLORS_INLINE[r.exchangeDisplay] ?? "bg-muted text-muted-foreground";
            return (
              <li
                key={r.symbol}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(r);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-sm transition-colors ${
                  i === highlighted ? "bg-accent" : "hover:bg-accent/50"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold leading-none">{r.symbol}</div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {r.name}
                  </div>
                </div>
                <span
                  className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${exColor}`}
                >
                  {r.exchangeDisplay || r.exchange}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {showHint && (
        <p className="text-[10px] text-muted-foreground mt-1">
          NSE: add .NS (RELIANCE.NS) · BSE: add .BO
        </p>
      )}
    </div>
  );
}
