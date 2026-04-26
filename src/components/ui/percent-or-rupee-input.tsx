"use client";

import { cn } from "@/lib/utils";

/**
 * Number input with a single-control toggle between absolute ₹ and % of a
 * `baseAmount`. Clicking the leading ₹ / % button BOTH flips the mode AND
 * auto-converts the entered value: ₹X becomes (X / base × 100) %, and vice
 * versa, so the underlying ₹ amount stays roughly the same after a toggle.
 */
export function PercentOrRupeeInput({
  value,
  onValueChange,
  mode,
  onModeChange,
  baseAmount,
  placeholder = "0",
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  mode: "RUPEE" | "PERCENT";
  onModeChange: (m: "RUPEE" | "PERCENT") => void;
  /** The number a percentage is applied to (e.g. gold value for wastage). */
  baseAmount: number;
  placeholder?: string;
  className?: string;
}) {
  function toggle() {
    const n = parseFloat(value);
    const nextMode = mode === "RUPEE" ? "PERCENT" : "RUPEE";
    onModeChange(nextMode);
    if (!Number.isFinite(n) || baseAmount <= 0) return; // nothing to convert
    if (mode === "RUPEE") {
      // ₹ → % : divide by base
      const pct = (n / baseAmount) * 100;
      onValueChange(roundStr(pct));
    } else {
      // % → ₹ : multiply by base
      const rupees = (baseAmount * n) / 100;
      onValueChange(roundStr(rupees, 0));
    }
  }
  return (
    <div
      className={cn(
        "flex h-9 items-stretch rounded-lg border border-input bg-transparent text-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/30",
        className,
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={`Toggle ${mode === "RUPEE" ? "to percent" : "to rupee"}`}
        className="flex w-8 items-center justify-center border-r border-input text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {mode === "RUPEE" ? "₹" : "%"}
      </button>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent px-3 outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );
}

function roundStr(n: number, decimals = 2): string {
  const factor = Math.pow(10, decimals);
  const r = Math.round(n * factor) / factor;
  return String(r);
}

/**
 * Resolve a (value, mode) pair into a ₹ number using the given base.
 * Empty / non-numeric inputs return 0.
 */
export function resolveAmount(
  value: string,
  mode: "RUPEE" | "PERCENT",
  baseAmount: number,
): number {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return mode === "RUPEE" ? n : (baseAmount * n) / 100;
}
