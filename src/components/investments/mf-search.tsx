"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, RefreshCw, Search } from "lucide-react";
import type { MfSearchResult } from "@/app/api/market/mf-search/route";
import { cn } from "@/lib/utils";

interface Props {
  /** Current fund name — the input IS the value, like BankPicker. */
  value: string;
  /** AMFI scheme code of the linked pick, if any. Shown as a hint. */
  schemeCode?: string | null;
  /**
   * Typing fires `onChange(text)` (free-text escape hatch — the fund list
   * can be stale or unreachable). Picking a suggestion fires
   * `onChange(name, scheme)` with the canonical AMFI row.
   */
  onChange: (name: string, scheme?: MfSearchResult) => void;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * AMFI mutual-fund autocomplete. Type a fund or AMC name → debounced search
 * against /api/market/mf-search → portaled dropdown of schemes with fund
 * house + latest NAV → picking one snaps the input to the official scheme
 * name. Free-typed text is kept verbatim so an unlisted / offline case
 * never blocks the form. Portal + fixed positioning mirror SymbolSearch so
 * the menu isn't clipped inside dialogs.
 */
export function MfSearch({
  value,
  schemeCode,
  onChange,
  required,
  placeholder,
  autoFocus,
}: Props) {
  const [results, setResults] = useState<MfSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    onChange(raw);
    setHighlighted(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = raw.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setOpen(true);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/market/mf-search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as MfSearchResult[] | { error: string };
        setResults(Array.isArray(data) ? data : []);
        setFailed(!Array.isArray(data));
      } catch {
        setResults([]);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function select(r: MfSearchResult) {
    setOpen(false);
    setResults([]);
    // Snap to the official name, capped to the investment name limit (120).
    onChange(r.name.slice(0, 120), r);
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
          value={value}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          placeholder={placeholder ?? "Search mutual funds… e.g. HDFC Top 100"}
          required={required}
          className="flex h-9 w-full rounded-lg border border-input bg-transparent pl-8 pr-9 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30 placeholder:text-muted-foreground"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {schemeCode && value ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Linked to AMFI scheme <span className="font-medium text-foreground">#{schemeCode}</span>
        </p>
      ) : value.trim().length >= 2 && !open ? (
        <p className="mt-1 text-[11px] text-muted-foreground truncate">
          Using custom name <strong className="text-foreground">&ldquo;{value}&rdquo;</strong>
        </p>
      ) : null}

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
                  {failed
                    ? "Couldn't load the fund list — your typed name will be kept."
                    : "No matching funds. Your typed name will be kept."}
                </p>
              ) : (
                <ul className="py-1">
                  {results.map((r, i) => (
                    <li key={r.schemeCode}>
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
                          <div className="text-xs font-medium">{r.name}</div>
                          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {r.fundHouse}
                          </div>
                        </div>
                        {r.nav != null && (
                          <span className="shrink-0 text-right">
                            <span className="block font-mono text-xs">
                              ₹{r.nav.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                            </span>
                            {r.navDate && (
                              <span className="block text-[10px] text-muted-foreground">
                                {r.navDate}
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
