"use client";

import Link from "next/link";
import { Gem } from "lucide-react";
import { formatINR, formatDate, cn } from "@/lib/utils";

export type ContactGoldRow = {
  id: string;
  name: string;
  itemType: string | null;
  purity: string | null;
  quantity: number;
  netWeightGrams: number;
  lineTotal: number;
  costBasis: number;
  declaredValue: number | null;
  status: "HELD" | "SOLD" | "GIFTED_OUT" | "EXCHANGED";
  disposedAt: string | null;
  disposalKind: string | null;
  disposalAmount: number | null;
  relation:
    | "BOUGHT_FOR_THEM"
    | "ASSIGNED"
    | "GIFTED_BY_THEM"
    | "GIVEN_TO_THEM";
  acquisition: {
    id: string;
    kind: "PURCHASE" | "GIFT_RECEIVED" | "OPENING_STOCK";
    sellerName: string | null;
    billNumber: string | null;
    acquiredAt: string;
  };
  memberCharge: {
    id: string;
    amount: number;
    settledAmount: number;
    status: string;
  } | null;
};

const SECTIONS: {
  relation: ContactGoldRow["relation"];
  title: string;
  blurb: string;
}[] = [
  {
    relation: "BOUGHT_FOR_THEM",
    title: "Bought for them",
    blurb: "Theirs — you fronted the money and they repay you.",
  },
  {
    relation: "ASSIGNED",
    title: "Assigned to them",
    blurb: "Yours; they wear it. Nothing is owed either way.",
  },
  {
    relation: "GIFTED_BY_THEM",
    title: "Gifted by them",
    blurb: "Yours now, with ₹0 invested. Nothing is owed either way.",
  },
  {
    relation: "GIVEN_TO_THEM",
    title: "Given to them",
    blurb: "Left your holdings — sold or gifted to them.",
  },
];

/**
 * A contact's gold, split by the role they play against each piece.
 *
 * Only the "bought for them" section carries money owed, and it reads
 * that straight off the MemberCharge the ornament created — so this tab
 * and the Charges tab can never disagree.
 */
export function ContactGoldTab({
  rows,
  contactName,
}: {
  rows: ContactGoldRow[];
  contactName: string;
}) {
  return (
    <div className="space-y-5">
      {SECTIONS.map((section) => {
        const items = rows.filter((r) => r.relation === section.relation);
        if (items.length === 0) return null;

        const owed = items.reduce(
          (a, r) =>
            r.memberCharge && r.memberCharge.status !== "WRITTEN_OFF"
              ? a + (r.memberCharge.amount - r.memberCharge.settledAmount)
              : a,
          0,
        );
        const grams = items.reduce((a, r) => a + r.netWeightGrams, 0);

        return (
          <div key={section.relation}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">
                  {section.title}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    ({items.length})
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground">{section.blurb}</p>
              </div>
              <div className="text-right text-xs tabular-nums">
                <div className="text-muted-foreground">
                  {grams.toFixed(3)}g
                </div>
                {section.relation === "BOUGHT_FOR_THEM" && owed > 0 && (
                  <div className="font-semibold text-amber-700 dark:text-amber-400">
                    {formatINR(owed)} owed to you
                  </div>
                )}
              </div>
            </div>

            <div className="divide-y rounded-lg border">
              {items.map((r) => (
                <Link
                  key={r.id}
                  href={`/investments/gold/${r.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-accent/40"
                >
                  <Gem className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {r.name}
                      </span>
                      {r.purity && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                          {r.purity}
                        </span>
                      )}
                      {r.status !== "HELD" &&
                        section.relation !== "GIVEN_TO_THEM" && (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                            {r.status === "SOLD"
                              ? "Sold"
                              : r.status === "EXCHANGED"
                                ? "Exchanged"
                                : "Gifted away"}
                          </span>
                        )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.netWeightGrams}g
                      {r.acquisition.sellerName
                        ? ` · ${r.acquisition.sellerName}`
                        : ""}
                      {r.acquisition.billNumber
                        ? ` · ${r.acquisition.billNumber}`
                        : ""}
                      {` · ${formatDate(
                        section.relation === "GIVEN_TO_THEM" && r.disposedAt
                          ? r.disposedAt
                          : r.acquisition.acquiredAt,
                      )}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">
                      {formatINR(
                        section.relation === "GIFTED_BY_THEM"
                          ? (r.declaredValue ?? r.lineTotal)
                          : section.relation === "GIVEN_TO_THEM" &&
                              r.disposalAmount != null
                            ? r.disposalAmount
                            : r.lineTotal,
                      )}
                    </div>
                    {r.memberCharge && (
                      <div
                        className={cn(
                          "text-[11px]",
                          r.memberCharge.amount -
                            r.memberCharge.settledAmount >
                            0
                            ? "text-amber-700 dark:text-amber-400"
                            : "text-emerald-700 dark:text-emerald-400",
                        )}
                      >
                        {r.memberCharge.amount - r.memberCharge.settledAmount >
                        0
                          ? `${formatINR(
                              r.memberCharge.amount -
                                r.memberCharge.settledAmount,
                            )} owed`
                          : "Settled"}
                      </div>
                    )}
                    {section.relation === "GIFTED_BY_THEM" && (
                      <div className="text-[11px] text-muted-foreground">
                        gift · ₹0 invested
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No gold linked to {contactName} yet.
        </p>
      )}
    </div>
  );
}
