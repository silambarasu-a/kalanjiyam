"use client";

import { useRef, useState, useEffect } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

/** Convert YYYY-MM-DD → DD/MM/YYYY for display */
function toDisplay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** Convert DD/MM/YYYY → YYYY-MM-DD for value */
function toIso(display: string): string {
  const parts = display.replace(/[^0-9/]/g, "").split("/");
  if (parts.length !== 3) return "";
  const [d, m, y] = parts;
  if (!d || !m || !y || y.length !== 4) return "";
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

interface DateInputProps {
  value: string; // YYYY-MM-DD
  onChange: (e: { target: { value: string } }) => void;
  min?: string;
  max?: string;
  required?: boolean;
  className?: string;
  disabled?: boolean;
}

export function DateInput({ value, onChange, min, max, required, className, disabled }: DateInputProps) {
  const hiddenRef = useRef<HTMLInputElement>(null);
  const [display, setDisplay] = useState(toDisplay(value));

  // Sync display when value prop changes externally.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived-state pattern, must persist across edits.
    setDisplay(toDisplay(value));
  }, [value]);

  function handleTextChange(raw: string) {
    // Allow typing with auto-formatting
    let cleaned = raw.replace(/[^0-9/]/g, "");

    // Auto-insert slashes
    if (cleaned.length === 2 && !cleaned.includes("/")) {
      cleaned += "/";
    } else if (cleaned.length === 5 && cleaned.indexOf("/") === 2 && cleaned.lastIndexOf("/") === 2) {
      cleaned += "/";
    }

    // Cap length
    if (cleaned.length > 10) cleaned = cleaned.slice(0, 10);

    setDisplay(cleaned);

    // Try to parse complete date
    if (cleaned.length === 10) {
      const iso = toIso(cleaned);
      if (iso && !isNaN(Date.parse(iso))) {
        onChange({ target: { value: iso } });
      }
    }
  }

  function handleTextBlur() {
    // On blur, try to parse what was typed
    if (display.length === 10) {
      const iso = toIso(display);
      if (iso && !isNaN(Date.parse(iso))) {
        onChange({ target: { value: iso } });
        return;
      }
    }
    // Revert to last valid value
    setDisplay(toDisplay(value));
  }

  function handlePickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const iso = e.target.value;
    if (iso) {
      setDisplay(toDisplay(iso));
      onChange({ target: { value: iso } });
    }
  }

  return (
    <div className="relative">
      {/* Visible text input showing dd/mm/yyyy */}
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(e) => handleTextChange(e.target.value)}
        onBlur={handleTextBlur}
        placeholder="DD/MM/YYYY"
        required={required}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-9 text-sm shadow-xs transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      />

      {/* Calendar icon + native date input overlaid on the icon area */}
      <div className="absolute right-0 top-0 h-full w-9 flex items-center justify-center">
        <CalendarDays className="h-4 w-4 text-muted-foreground/60 pointer-events-none" />
        <input
          ref={hiddenRef}
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={handlePickerChange}
          className="absolute inset-0 opacity-0 cursor-pointer"
          tabIndex={-1}
          aria-hidden
        />
      </div>
    </div>
  );
}
