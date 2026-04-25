import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowDownLeft,
  ArrowUpRight,
  CircleCheck,
  Wallet2,
  HandCoins,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Visual tone vocabulary used for money values across the app.
 *
 *   gain      — green primary, ↗ (positive movement / income / owed-to-you)
 *   loss      — red destructive, ↘ (negative movement / expense / overdue)
 *   neutral   — muted ink, dash (no change)
 *   invested  — sky accent, ↘ (capital deployed into investments)
 *   advance   — amber, ↘ (paid ahead of work / advance taken)
 *   settled   — muted check (cleared)
 *   outstanding — amber, wallet (still owed)
 *   owed_in   — primary, hand (someone owes you)
 *   owed_out  — destructive, hand (you owe someone)
 */
export type MoneyTone =
  | "gain"
  | "loss"
  | "neutral"
  | "invested"
  | "advance"
  | "settled"
  | "outstanding"
  | "owed_in"
  | "owed_out";

const TONE_TEXT: Record<MoneyTone, string> = {
  gain: "text-primary",
  loss: "text-destructive",
  neutral: "text-muted-foreground",
  invested: "text-sky-600 dark:text-sky-400",
  advance: "text-amber-600 dark:text-amber-400",
  settled: "text-muted-foreground",
  outstanding: "text-amber-700 dark:text-amber-400",
  owed_in: "text-primary",
  owed_out: "text-destructive",
};

const TONE_BG: Record<MoneyTone, string> = {
  gain: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  loss: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  neutral: "bg-muted text-muted-foreground",
  invested: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400",
  advance: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  settled: "bg-muted text-muted-foreground",
  outstanding: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  owed_in: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  owed_out: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400",
};

const TONE_ICON: Record<MoneyTone, LucideIcon> = {
  gain: TrendingUp,
  loss: TrendingDown,
  neutral: Minus,
  invested: ArrowDownLeft,
  advance: ArrowUpRight,
  settled: CircleCheck,
  outstanding: Wallet2,
  owed_in: HandCoins,
  owed_out: HandCoins,
};

/** Pick a tone from a signed amount (positive = gain, zero = settled). */
export function toneFromBalance(balance: number, settledLabel: MoneyTone = "settled"): MoneyTone {
  if (balance > 0) return "gain";
  if (balance < 0) return "loss";
  return settledLabel;
}

/**
 * Inline money value with a small leading trend icon. Use for stat readouts.
 *
 *   <MoneyValue tone="gain" value="+₹12,450" />
 */
export function MoneyValue({
  tone,
  value,
  className,
  icon = true,
  iconClassName,
}: {
  tone: MoneyTone;
  value: string;
  className?: string;
  icon?: boolean;
  iconClassName?: string;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 tabular-nums", TONE_TEXT[tone], className)}>
      {icon && <Icon className={cn("h-4 w-4 shrink-0", iconClassName)} />}
      {value}
    </span>
  );
}

/**
 * Small status pill — "OWED · 12d", "ADVANCE", "SETTLED", etc.
 */
export function ToneBadge({
  tone,
  label,
  icon = true,
  className,
}: {
  tone: MoneyTone;
  label: string;
  icon?: boolean;
  className?: string;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        TONE_BG[tone],
        className
      )}
    >
      {icon && <Icon className="h-3 w-3" />}
      {label}
    </span>
  );
}
