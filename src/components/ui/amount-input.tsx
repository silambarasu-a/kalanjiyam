"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * AmountInput — text-mode currency input with Indian grouping (12,34,567.89).
 * The internal value the parent stores is the raw numeric string ("12345.67"
 * or ""). The display layer adds commas using the en-IN convention. Decimal
 * is capped at 2 places.
 *
 * Usage:
 *   const [amount, setAmount] = useState("");
 *   <AmountInput value={amount} onChange={setAmount} placeholder="0" />
 *
 * Then `Number(amount)` gives you the number for submit.
 */
export type AmountInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type" | "inputMode"
> & {
  value: string;
  onChange: (raw: string) => void;
};

export function AmountInput({
  value,
  onChange,
  className,
  placeholder = "0",
  ...rest
}: AmountInputProps) {
  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Strip everything except digits and decimal.
    let cleaned = raw.replace(/[^\d.]/g, "");
    // Collapse multiple decimals: keep only the first.
    const dot = cleaned.indexOf(".");
    if (dot !== -1) {
      cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
    }
    // Cap to 2 decimals.
    if (dot !== -1) {
      const [intPart, decPart] = cleaned.split(".");
      cleaned = decPart.length > 2 ? `${intPart}.${decPart.slice(0, 2)}` : cleaned;
    }
    // Drop leading zeros (but keep "0." cases).
    if (cleaned.length > 1 && cleaned.startsWith("0") && !cleaned.startsWith("0.")) {
      cleaned = cleaned.replace(/^0+/, "") || "0";
    }
    onChange(cleaned);
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        ₹
      </span>
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={formatIndianGrouping(value)}
        onChange={handle}
        placeholder={placeholder}
        className={cn("pl-6 tabular-nums", className)}
        {...rest}
      />
    </div>
  );
}

/**
 * Format a raw numeric-string with Indian grouping. Lakh/crore convention:
 * last three digits are grouped together, then every two digits to the left.
 *   "1234567.89" → "12,34,567.89"
 *   "1000"      → "1,000"
 *   "100000"    → "1,00,000"
 */
export function formatIndianGrouping(raw: string): string {
  if (!raw) return "";
  const negative = raw.startsWith("-");
  const stripped = negative ? raw.slice(1) : raw;
  const [intPart, decPart] = stripped.split(".");
  const digits = (intPart || "").replace(/\D/g, "");
  let groupedInt: string;
  if (digits.length <= 3) {
    groupedInt = digits;
  } else {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    const restWithCommas = rest.replace(/(\d)(?=(\d{2})+$)/g, "$1,");
    groupedInt = `${restWithCommas},${last3}`;
  }
  const hasDot = stripped.includes(".");
  const out = hasDot ? `${groupedInt}.${decPart ?? ""}` : groupedInt;
  return negative ? `-${out}` : out;
}
