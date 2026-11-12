"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { NavigatingCard } from "@/components/ui/navigating-card";
import { MoneyValue } from "@/components/ui/money-tone";
import { InvestmentActions } from "@/components/investments/investment-actions";
import { formatINR, formatDate, cn } from "@/lib/utils";
import {
  COMPOUNDING_LABEL,
  daysUntil,
  depositValuation,
  formatDaysAway,
  formatTenure,
  fundValuation,
  type FundNavInput,
  type HoldingValue,
} from "@/lib/investment-valuation";

export type InvestmentKind =
  | "STOCK"
  | "MUTUAL_FUND"
  | "SIP"
  | "FD"
  | "RD"
  | "INSURANCE"
  | "GOLD"
  | "OTHER";

/** One row of `GET /api/investments`, as the list and its cards read it. */
export type HoldingListItem = {
  id: string;
  kind: InvestmentKind;
  name: string;
  institution: string | null;
  amount: number;
  currentValue: number | null;
  interestRate: number | null;
  compoundingFrequency: string | null;
  startedAt: string;
  maturityAt: string | null;
  maturityValue: number | null;
  active: boolean;
  symbol: string | null;
  quantity: number | null;
  purchasePrice: number | null;
  purchaseExchangeRate: number | null;
  currency: string | null;
  policyNumber: string | null;
  policyType: string | null;
  premiumAmount: number | null;
  premiumFrequency: string | null;
  sumAssured: number | null;
  nextDueDate: string | null;
  insuranceStatus: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  /** Brokerage this holding sits in, when linked. */
  brokerage?: { id: string; name: string; currency: string } | null;
};

const FREQUENCY_LABEL: Record<string, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly",
  EVERY_2_YEARS: "Every 2 years",
  EVERY_3_YEARS: "Every 3 years",
  EVERY_5_YEARS: "Every 5 years",
  ONE_TIME: "One-time",
};

const POLICY_TYPE_LABEL: Record<string, string> = {
  LIFE: "Life",
  TERM: "Term",
  HEALTH: "Health",
  ENDOWMENT: "Endowment",
  ULIP: "ULIP",
  VEHICLE: "Vehicle",
  HOME: "Home",
  TRAVEL: "Travel",
  OTHER: "Other",
};

const GOLD_TYPE_LABEL: Record<string, string> = {
  ORNAMENTS: "Ornaments",
  BAR: "Bar",
  COIN: "Coin",
  SGB: "Sovereign Gold Bond",
  DIGITAL: "Digital gold",
  ETF: "Gold ETF",
};

type Fact = { label: string; value: string; tone?: "gain" | "loss" | "warn" };

const fmtQty = (n: number, max = 4) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: max });

/** A per-unit rupee price — NAVs are quoted to four decimals. */
const fmtNav = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/** "12/03/2027 · in 120 days". */
function dateWithDistance(date: string, now: Date): string {
  return `${formatDate(date)} · ${formatDaysAway(daysUntil(date, now))}`;
}

/** AMFI prints "04-Aug-2026". */
const fmtNavDate = (d: string | null) => (d ? d.replace(/-/g, " ") : null);

/**
 * Everything kind-specific about a card: the line under the name, the
 * fact grid, what the small print under the value calls the cost, and an
 * optional note explaining why a figure is missing.
 */
function describe(
  h: HoldingListItem,
  ctx: {
    now: Date;
    nav: FundNavInput;
    navReady: boolean;
    livePrice: number;
    dayChangePct: number;
    isLive: boolean;
  },
): { subtitle: string; facts: Fact[]; costLabel: string; note: string | null; badge: string | null } {
  const place = h.brokerage?.name ?? h.institution;
  const facts: Fact[] = [];
  let subtitle = place ?? "";
  let costLabel = "invested";
  let note: string | null = null;
  let badge: string | null = null;

  switch (h.kind) {
    case "STOCK": {
      const usd = h.currency === "USD";
      const sym = usd ? "$" : "₹";
      const price = (n: number) =>
        `${sym}${n.toLocaleString(usd ? "en-US" : "en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      subtitle = [place, h.symbol].filter(Boolean).join(" · ");
      if (h.quantity != null) facts.push({ label: "Shares", value: fmtQty(h.quantity, 6) });
      if (h.purchasePrice != null && h.purchasePrice > 0) {
        facts.push({ label: "Avg price", value: price(h.purchasePrice) });
      }
      if (ctx.isLive) {
        facts.push({
          label: "Live price",
          value: `${price(ctx.livePrice)} · ${ctx.dayChangePct >= 0 ? "+" : "−"}${Math.abs(ctx.dayChangePct).toFixed(2)}%`,
          tone: ctx.dayChangePct >= 0 ? "gain" : "loss",
        });
      }
      if (usd) badge = "USD";
      break;
    }

    case "MUTUAL_FUND":
    case "SIP": {
      const f = fundValuation(h, ctx.nav, ctx.now);
      if (f.units != null) facts.push({ label: "Units", value: fmtQty(f.units) });
      if (f.avgNav != null) facts.push({ label: "Avg NAV", value: fmtNav(f.avgNav) });
      if (f.nav != null) {
        const asOf = fmtNavDate(f.navDate);
        facts.push({
          label: "Latest NAV",
          value: asOf ? `${fmtNav(f.nav)} · ${asOf}` : fmtNav(f.nav),
        });
      }
      if (h.kind === "SIP") {
        if (h.premiumFrequency) {
          facts.push({
            label: "Instalment",
            value:
              h.premiumAmount != null
                ? `${formatINR(h.premiumAmount)} · ${FREQUENCY_LABEL[h.premiumFrequency] ?? h.premiumFrequency}`
                : (FREQUENCY_LABEL[h.premiumFrequency] ?? h.premiumFrequency),
          });
        }
        if (h.nextDueDate) {
          facts.push({ label: "Next instalment", value: dateWithDistance(h.nextDueDate, ctx.now) });
        }
      }
      if (f.missing === "SCHEME") {
        note = "Not linked to an AMFI scheme, so it is shown at cost. Edit it and pick the fund from the search to track its NAV.";
      } else if (f.missing === "UNITS") {
        note = "No units recorded, so it is shown at cost. Edit it and enter the units you hold.";
      } else if (f.missing === "PARTIAL") {
        note = "Some instalments were recorded without units, so it is shown at cost. Edit it and set the total units you hold.";
      } else if (f.missing === "MISMATCH") {
        note = `The linked scheme's NAV (${fmtNav(f.nav ?? 0)}) is nowhere near your average NAV (${fmtNav(f.avgNav ?? 0)}), so it is shown at cost. Edit it and re-pick the exact plan and option, or correct the units.`;
      } else if (f.missing === "NAV" && ctx.navReady) {
        note = "Couldn't get the latest NAV from AMFI — shown at cost for now.";
      }
      break;
    }

    case "FD":
    case "RD": {
      const d = depositValuation(h, ctx.now);
      costLabel = h.kind === "FD" ? "principal" : "deposited";
      if (h.kind === "RD" && h.premiumAmount != null) {
        facts.push({ label: "Instalment", value: `${formatINR(h.premiumAmount)} / month` });
      }
      if (d.ratePct != null) {
        facts.push({
          label: "Interest",
          value: `${d.ratePct}% p.a. · ${COMPOUNDING_LABEL[d.compounding].toLowerCase()}`,
        });
      }
      if (d.tenureDays != null) facts.push({ label: "Tenure", value: formatTenure(d.tenureDays) });
      if (h.maturityAt) {
        facts.push({
          label: d.matured ? "Matured" : "Matures",
          value: dateWithDistance(h.maturityAt, ctx.now),
          tone: d.matured ? "warn" : undefined,
        });
      }
      if (d.maturityAmount != null) {
        facts.push({
          label: d.maturityStated ? "Maturity amount" : "Maturity amount (est.)",
          value: formatINR(d.maturityAmount),
        });
      }
      if (d.interestAtMaturity != null) {
        facts.push({ label: "Interest at maturity", value: formatINR(d.interestAtMaturity) });
      }
      if (d.matured && h.active) badge = "Matured";
      if (!d.accrues) {
        note =
          h.kind === "FD"
            ? "Add the interest rate, or the maturity amount from the receipt, to see what this deposit is worth today."
            : "Add the interest rate to see what this deposit is worth today.";
      } else if (h.kind === "RD" && d.maturityAmount == null && h.maturityAt) {
        note = "Add the monthly instalment to estimate the maturity amount.";
      }
      break;
    }

    case "INSURANCE": {
      costLabel = "premiums paid";
      subtitle = [
        h.policyType ? `${POLICY_TYPE_LABEL[h.policyType] ?? h.policyType} policy` : null,
        h.policyNumber ? `#${h.policyNumber}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (h.sumAssured != null) facts.push({ label: "Sum assured", value: formatINR(h.sumAssured) });
      if (h.premiumAmount != null) {
        facts.push({
          label: "Premium",
          value: h.premiumFrequency
            ? `${formatINR(h.premiumAmount)} · ${FREQUENCY_LABEL[h.premiumFrequency] ?? h.premiumFrequency}`
            : formatINR(h.premiumAmount),
        });
      }
      if (h.nextDueDate) {
        const overdue = daysUntil(h.nextDueDate, ctx.now) < 0;
        facts.push({
          label: "Next premium",
          value: dateWithDistance(h.nextDueDate, ctx.now),
          tone: overdue && h.active ? "loss" : undefined,
        });
      }
      if (h.maturityAt) {
        facts.push({ label: "Maturity / expiry", value: dateWithDistance(h.maturityAt, ctx.now) });
      }
      if (h.maturityValue != null) {
        facts.push({ label: "Maturity value", value: formatINR(h.maturityValue) });
      }
      if (h.insuranceStatus && h.insuranceStatus !== "ACTIVE") {
        badge = h.insuranceStatus.charAt(0) + h.insuranceStatus.slice(1).toLowerCase();
      }
      break;
    }

    case "GOLD": {
      const m = h.metadata ?? {};
      const type = typeof m.goldType === "string" ? (GOLD_TYPE_LABEL[m.goldType] ?? m.goldType) : null;
      subtitle = [type, place].filter(Boolean).join(" · ");
      if (h.quantity != null && h.quantity > 0) {
        facts.push({ label: "Weight", value: `${fmtQty(h.quantity, 3)} g` });
      }
      if (typeof m.purity === "string" && m.purity) facts.push({ label: "Purity", value: m.purity });
      if (h.purchasePrice != null && h.purchasePrice > 0) {
        facts.push({ label: "Bought at", value: `${formatINR(h.purchasePrice)} / g` });
      }
      const v = m.valuation as { ratePerGram24K?: number; valuedAt?: string } | undefined;
      if (v?.ratePerGram24K && v.valuedAt) {
        facts.push({
          label: "Valued at",
          value: `${formatINR(v.ratePerGram24K)} / g (24K) · ${formatDate(v.valuedAt)}`,
        });
      } else if (h.currentValue == null) {
        note = "Not revalued yet — shown at what you paid. Set today's rate on the Gold page.";
      }
      break;
    }

    default: {
      if (h.interestRate != null) facts.push({ label: "Return", value: `${h.interestRate}% p.a.` });
      if (h.maturityAt) facts.push({ label: "Matures", value: dateWithDistance(h.maturityAt, ctx.now) });
      break;
    }
  }

  facts.push({ label: h.kind === "INSURANCE" ? "Policy start" : "Started", value: formatDate(h.startedAt) });
  if (!h.active) badge = "Closed";
  return { subtitle, facts, costLabel, note, badge };
}

export function HoldingCard({
  holding: h,
  value,
  now,
  nav,
  navReady,
  livePrice = 0,
  dayChangePct = 0,
}: {
  holding: HoldingListItem;
  value: HoldingValue;
  now: Date;
  /** Latest NAV for the holding's scheme (MUTUAL_FUND / SIP). */
  nav?: FundNavInput;
  /** False while the NAV request is still out — holds back "no NAV" notes. */
  navReady: boolean;
  livePrice?: number;
  dayChangePct?: number;
}) {
  const isLive = value.basis === "LIVE";
  const { subtitle, facts, costLabel, note, badge } = describe(h, {
    now,
    nav,
    navReady,
    livePrice,
    dayChangePct,
    isLive,
  });
  // A gain is only worth printing when the current value is a real
  // reading — not when it just echoes the cost.
  const showGain =
    value.basis !== "COST" && value.invested > 0 && Math.abs(value.gain) >= 0.5 && h.kind !== "INSURANCE";

  return (
    <NavigatingCard
      href={`/investments/${h.id}`}
      className={cn(
        "rounded-xl border bg-card p-4 transition hover:bg-accent/40 sm:p-5",
        !h.active && "opacity-60",
      )}
      ariaLabel={`Open ${h.name}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{h.name}</span>
            {badge && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  badge === "Matured"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    : badge === "USD"
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="font-semibold tabular-nums">{formatINR(value.current)}</div>
          {showGain && (
            <MoneyValue
              tone={value.gain >= 0 ? "gain" : "loss"}
              value={`${value.gain >= 0 ? "+" : "−"}${formatINR(Math.abs(value.gain))} · ${value.gain >= 0 ? "+" : "−"}${Math.abs(value.gainPct).toFixed(2)}%`}
              className="mt-0.5 text-[11px]"
              iconClassName="h-3 w-3"
            />
          )}
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {costLabel} {formatINR(value.invested)}
          </div>
        </div>
        <InvestmentActions
          investment={{ id: h.id, name: h.name }}
          stopPropagation
          className="flex shrink-0 flex-col items-center gap-0.5"
        />
      </div>

      {facts.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 sm:grid-cols-3">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {f.label}
              </dt>
              <dd
                className={cn(
                  "mt-0.5 flex items-center gap-0.5 text-xs font-medium tabular-nums",
                  f.tone === "gain" && "text-emerald-700 dark:text-emerald-400",
                  f.tone === "loss" && "text-red-700 dark:text-red-400",
                  f.tone === "warn" && "text-amber-700 dark:text-amber-400",
                )}
              >
                {f.label === "Live price" &&
                  (f.tone === "gain" ? (
                    <ArrowUpRight className="h-3 w-3 shrink-0" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3 shrink-0" />
                  ))}
                <span className="min-w-0 break-words">{f.value}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {note && <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">{note}</p>}
    </NavigatingCard>
  );
}
