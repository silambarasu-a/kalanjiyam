"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { AmountInput } from "@/components/ui/amount-input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { mutateBalances } from "@/lib/mutate-balances";
import { formatINR, formatDate, groupAccountOptions } from "@/lib/utils";
import { BulkSettleDialog } from "@/components/contacts/bulk-settle-dialog";
import { ContactStatement } from "@/components/contacts/contact-statement";
import { TransactionDetailDialog } from "@/components/transactions/transaction-detail-dialog";
import { ContactAttachmentsPanel } from "@/components/contacts/contact-attachments-panel";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { fetcher } from "@/lib/swr-fetcher";

type Settlement = { id: string; amount: number; paidAt: string; notes: string | null };
type Charge = {
  id: string;
  amount: number;
  settledAmount: number;
  status: "OUTSTANDING" | "PARTIAL" | "SETTLED" | "WRITTEN_OFF";
  direction: "OWED_TO_USER" | "USER_OWES";
  notes: string | null;
  createdAt: string;
  sourceTransferId: string | null;
  lastSettlementAt: string | null;
  origin: { id: string; description: string; date: string } | null;
  settlements: Settlement[];
};
type Transfer = {
  id: string;
  amount: number;
  date: string;
  notes: string | null;
  direction: "TO_CONTACT" | "FROM_CONTACT";
  account: { id: string; name: string } | null;
};
type SpentExpense = {
  id: string;
  amount: number;
  date: string;
  description: string;
  kind: "NONE" | "GIFT" | "RECOVERABLE";
  isPartialOfTotal: boolean;
  transactionAmount: number;
  account: { id: string; name: string } | null;
};
type LinkedLoan = {
  id: string;
  kind: string;
  direction: "BORROWED" | "LENT";
  repaymentMode: "EMI" | "AD_HOC";
  principal: number;
  outstanding: number;
  startedAt: string;
  nextDueDate: string | null;
  active: boolean;
  emiAmount: number | null;
  interestRate: number | null;
  interestCadence: string | null;
};
type Ledger = {
  member: { id: string; name: string };
  totals: {
    outstanding: number;
    owedToUser: number;
    userOwes: number;
    settled: number;
    sentToContact: number;
    receivedFromContact: number;
    netTransferred: number;
    spentOnThem: number;
    /** Open principal on money they lent YOU. */
    loansOwed: number;
    /** Open principal on money YOU lent them. Never netted with loansOwed. */
    loansLent: number;
    /** Their money parked with you, spendable against their future charges. */
    advanceHeld: number;
    /** Your money parked with them. Never netted against advanceHeld. */
    advancePaid: number;
  };
  charges: Charge[];
  transfers: Transfer[];
  expenses: SpentExpense[];
  loans: LinkedLoan[];
  /** Expenses THIS contact paid for the workspace owner (paidByContactId
   *  flow). RECOVERABLE rows are mirrored as a USER_OWES MemberCharge
   *  under `charges`; GIFT rows live only here (informational). */
  paidForMe?: {
    id: string;
    amount: number;
    date: string;
    description: string;
    memberChargeType: "NONE" | "RECOVERABLE" | "GIFT";
    category: {
      id: string;
      name: string;
      parent: { id: string; name: string } | null;
    } | null;
  }[];
};
type Account = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  availableLimit: number | null;
};


export default function MemberLedgerDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data } = useSWR<Ledger>(id ? `/api/contacts/${id}/ledger` : null, fetcher);
  const { data: accountsData } = useSWR<{ accounts: Account[] }>("/api/accounts", fetcher);
  const accounts = (accountsData?.accounts ?? []).filter((a) => a.kind !== "CARD");
  const { data: medicalData } = useSWR<{
    records: {
      id: string;
      kind: "CHECKUP" | "HOSPITALIZATION";
      facilityName: string;
      diagnosis: string | null;
      occurredAt: string;
      dischargedAt: string | null;
      claim: { status: string } | null;
      transactionCount: number;
    }[];
  }>(id ? `/api/medical-records?patientContactId=${id}` : null, fetcher);
  const medicalRecords = medicalData?.records ?? [];
  const [settleCharge, setSettleCharge] = useState<Charge | null>(null);
  const [forgivingChargeId, setForgivingChargeId] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState<"SEND" | "RECEIVE" | null>(null);
  const [bulkSettleDirection, setBulkSettleDirection] = useState<
    "OWED_TO_USER" | "USER_OWES" | null
  >(null);
  // Transaction opened in the read-only detail dialog (full data + receipts).
  const [detailTxnId, setDetailTxnId] = useState<string | null>(null);
  const { data: attachData } = useSWR<{ count: number }>(
    id ? `/api/contacts/${id}/attachments` : null,
    fetcher,
  );
  // Contact-owned documents. Same SWR key AttachmentList uses, so the badge
  // stays in sync as documents are uploaded / deleted below.
  const { data: contactDocsData } = useSWR<{ attachments: unknown[] }>(
    id
      ? `/api/attachments?ownerKind=CONTACT_DOCUMENT&ownerId=${encodeURIComponent(id)}`
      : null,
    fetcher,
  );
  const attachmentCount =
    (attachData?.count ?? 0) + (contactDocsData?.attachments.length ?? 0);

  async function forgiveCharge(chargeId: string) {
    setForgivingChargeId(chargeId);
    try {
      const res = await fetch(`/api/member-charges/${chargeId}/forgive`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}) as { error?: string });
      if (!res.ok) {
        toast.error(body.error ?? "Failed to forgive");
        return;
      }
      toast.success("Charge forgiven");
      globalMutate(`/api/contacts/${id}/ledger`);
    } finally {
      setForgivingChargeId(null);
    }
  }

  const openCharges = data?.charges?.filter((c) => c.status !== "WRITTEN_OFF") ?? [];
  const forgivenCharges = data?.charges?.filter((c) => c.status === "WRITTEN_OFF") ?? [];

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data.member) {
    return (
      <p className="text-sm text-muted-foreground">
        Contact not found.{" "}
        <Link href="/contacts" className="underline">
          Back to contacts
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-6 print-container">
      <div>
        <Link href="/contacts" className="text-xs text-muted-foreground no-print">
          ← Contacts
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{data.member.name}</h1>
        <p className="text-sm text-muted-foreground">
          Ledger, transfers and a full financial statement for this contact.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat
          label="They owe you"
          value={formatINR(data.totals.owedToUser ?? 0)}
          highlight={(data.totals.owedToUser ?? 0) > 0}
        />
        <Stat
          label="You owe them"
          value={formatINR(data.totals.userOwes ?? 0)}
          highlight={(data.totals.userOwes ?? 0) > 0}
        />
        <Stat label="Settled to date" value={formatINR(data.totals.settled)} />
        <Stat
          label="Net transferred"
          value={formatINR(Math.abs(data.totals.netTransferred))}
          hint={
            data.totals.netTransferred > 0
              ? "you sent more"
              : data.totals.netTransferred < 0
                ? "they sent more"
                : "balanced"
          }
        />
        {/* Owe and owed are shown as two labelled numbers, never one netted
            figure or an either/or — you can be on both sides at once. */}
        {data.totals.loansLent > 0 || data.totals.loansOwed > 0 ? (
          <>
            <Stat
              label="They owe you"
              value={formatINR(data.totals.loansLent)}
              hint="open lent principal"
            />
            <Stat
              label="You owe them"
              value={formatINR(data.totals.loansOwed)}
              hint="open hand-loan principal"
            />
          </>
        ) : (
          <Stat
            label="Spent on them"
            value={formatINR(data.totals.spentOnThem)}
            hint="not recovered"
          />
        )}
      </div>

      {/* Advance credit is its own position — money parked, not money owed —
          so it sits outside the owe/owed grid rather than being folded into
          it. Both directions can be live at once. */}
      {(data.totals.advanceHeld > 0 || data.totals.advancePaid > 0) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {data.totals.advanceHeld > 0 && (
            <span className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-1.5">
              <span className="font-medium">
                {formatINR(data.totals.advanceHeld)}
              </span>{" "}
              <span className="text-muted-foreground">
                of their money held as advance credit
              </span>
            </span>
          )}
          {data.totals.advancePaid > 0 && (
            <span className="rounded-md border border-sky-500/40 bg-sky-500/5 px-3 py-1.5">
              <span className="font-medium">
                {formatINR(data.totals.advancePaid)}
              </span>{" "}
              <span className="text-muted-foreground">
                of your money sitting with them
              </span>
            </span>
          )}
        </div>
      )}

      <Tabs defaultValue="statement" className="gap-3">
        <TabsList
          variant="line"
          className="border-b w-full justify-start gap-3 rounded-none overflow-x-auto no-print"
        >
          <TabsTrigger value="statement">Statement</TabsTrigger>
          <TabsTrigger value="charges">
            Charges
            {openCharges.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({openCharges.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="transfers">
            Transfers
            {data.transfers.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({data.transfers.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="loans">
            Hand loans
            {data.loans.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({data.loans.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="attachments">
            Attachments
            {attachmentCount > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({attachmentCount})
              </span>
            )}
          </TabsTrigger>
          {data.expenses.length > 0 && (
            <TabsTrigger value="expenses">
              Spent on them
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({data.expenses.length})
              </span>
            </TabsTrigger>
          )}
          {(data.paidForMe?.length ?? 0) > 0 && (
            <TabsTrigger value="paidForMe">
              They paid for me
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({data.paidForMe?.length})
              </span>
            </TabsTrigger>
          )}
          {medicalRecords.length > 0 && (
            <TabsTrigger value="medical">
              Medical
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({medicalRecords.length})
              </span>
            </TabsTrigger>
          )}
          {forgivenCharges.length > 0 && (
            <TabsTrigger value="forgiven">
              Forgiven
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({forgivenCharges.length})
              </span>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="statement">
          <ContactStatement
            contactId={id ?? ""}
            contactName={data.member.name}
            onViewTransaction={(txnId) => setDetailTxnId(txnId)}
          />
        </TabsContent>

        <TabsContent value="charges">
          {(() => {
            const oweMeOpen = openCharges.filter(
              (c) => c.direction === "OWED_TO_USER",
            );
            const owedOpen = openCharges.filter(
              (c) => c.direction === "USER_OWES",
            );
            return (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {oweMeOpen.length > 0 && (
                  <Button
                    size="sm"
                    onClick={() => setBulkSettleDirection("OWED_TO_USER")}
                    className="gap-1.5"
                  >
                    Receive from {data.member.name}
                    <span className="text-[10px] opacity-80">
                      ({oweMeOpen.length})
                    </span>
                  </Button>
                )}
                {owedOpen.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setBulkSettleDirection("USER_OWES")}
                    className="gap-1.5"
                  >
                    Pay {data.member.name}
                    <span className="text-[10px] opacity-80">
                      ({owedOpen.length})
                    </span>
                  </Button>
                )}
              </div>
            );
          })()}
          <div className="rounded-lg border bg-card divide-y">
            {openCharges.map((c) => {
              const remaining = c.amount - c.settledAmount;
              return (
                <div key={c.id} className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    {c.origin ? (
                      <button
                        type="button"
                        onClick={() => setDetailTxnId(c.origin!.id)}
                        className="group flex-1 min-w-0 text-left"
                        title="View full transaction details"
                      >
                        <div className="font-medium truncate group-hover:underline">
                          {c.origin.description}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(c.origin.date)} · {c.status} ·{" "}
                          <span className="text-primary group-hover:underline">
                            View details
                          </span>
                        </div>
                      </button>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">Charge</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(c.createdAt)} · {c.status}
                        </div>
                      </div>
                    )}
                    <div className="text-right">
                      <div className="font-semibold">{formatINR(c.amount)}</div>
                      {c.settledAmount > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Settled: {formatINR(c.settledAmount)}
                        </div>
                      )}
                    </div>
                    {c.status !== "SETTLED" && c.status !== "WRITTEN_OFF" && (
                      <div className="flex flex-col gap-1 items-stretch">
                        <Button size="sm" variant="outline" onClick={() => setSettleCharge(c)}>
                          Settle
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={forgivingChargeId === c.id}
                          onClick={() => forgiveCharge(c.id)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {forgivingChargeId === c.id ? "…" : "Forgive"}
                        </Button>
                      </div>
                    )}
                  </div>
                  {c.settlements.length > 0 && (
                    <ul className="mt-2 ml-1 border-l pl-3 space-y-1">
                      {c.settlements.map((s) => (
                        <li key={s.id} className="text-xs text-muted-foreground">
                          {formatDate(s.paidAt)} · {formatINR(s.amount)}
                          {s.notes ? ` · ${s.notes}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  {remaining > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Remaining: {formatINR(remaining)}
                    </div>
                  )}
                </div>
              );
            })}
            {openCharges.length === 0 && (
              <div className="px-5 py-8 text-sm text-muted-foreground text-center">
                No open charges.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="transfers">
          <div className="flex items-center justify-end gap-2 mb-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTransferOpen("SEND")}
              className="gap-1.5"
            >
              <ArrowUpRight className="h-3.5 w-3.5" /> Send
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTransferOpen("RECEIVE")}
              className="gap-1.5"
            >
              <ArrowDownLeft className="h-3.5 w-3.5" /> Receive
            </Button>
            {data.transfers.length > 0 && (
              <Link
                href={`/transfers?contact=${id}`}
                className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground self-center px-2"
              >
                View all
              </Link>
            )}
          </div>
          <div className="rounded-lg border bg-card divide-y">
            {data.transfers.map((t) => {
              const out = t.direction === "TO_CONTACT";
              return (
                <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{formatDate(t.date)}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {out ? "You sent" : "They sent"}
                      {t.account ? ` · ${t.account.name}` : ""}
                      {t.notes ? ` · ${t.notes}` : ""}
                    </div>
                  </div>
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      out
                        ? "text-destructive"
                        : "text-emerald-700 dark:text-emerald-400"
                    }`}
                  >
                    {out ? "−" : "+"}
                    {formatINR(t.amount)}
                  </div>
                </div>
              );
            })}
            {data.transfers.length === 0 && (
              <div className="px-5 py-6 text-sm text-muted-foreground text-center">
                No transfers with this contact yet.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="loans">
          {/* Grouped by direction rather than mixed: an outstanding balance
              means opposite things on the two sides. */}
          {(
            [
              {
                key: "LENT" as const,
                heading: "You lent them",
                manageHref: "/loans/hand/lent",
                manageLabel: "Manage money lent",
              },
              {
                key: "BORROWED" as const,
                heading: "They lent you",
                manageHref: "/loans/hand",
                manageLabel: "Manage hand loans",
              },
            ]
          ).map((group) => {
            const rows = data.loans.filter((l) => l.direction === group.key);
            if (rows.length === 0) return null;
            return (
              <div key={group.key} className="mb-4 last:mb-0">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {group.heading}
                  </h3>
                  <Link
                    href={group.manageHref}
                    className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground px-2"
                  >
                    {group.manageLabel}
                  </Link>
                </div>
                <div className="rounded-lg border bg-card divide-y">
                  {rows.map((l) => {
                    const paid = Math.max(0, l.principal - l.outstanding);
                    const pct =
                      l.principal > 0
                        ? Math.min(100, (paid / l.principal) * 100)
                        : 0;
                    const isLent = l.direction === "LENT";
                    return (
                      <div key={l.id} className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Link
                            href={`/loans/${l.id}`}
                            className="flex-1 min-w-0 -mx-5 px-5 py-1 rounded-md hover:bg-accent/40 transition"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{l.kind}</span>
                              {!l.active && (
                                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                                  cleared
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Started {formatDate(l.startedAt)}
                              {l.interestRate != null && l.interestRate > 0
                                ? ` · ${l.interestRate}% p.a.`
                                : " · interest-free"}
                              {l.nextDueDate && l.active
                                ? ` · next ${isLent ? "collection" : "due"} ${formatDate(l.nextDueDate)}`
                                : ""}
                            </div>
                          </Link>
                          <div className="text-right">
                            <div className="text-sm font-semibold tabular-nums">
                              {formatINR(l.outstanding)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              of {formatINR(l.principal)}
                            </div>
                          </div>
                          {l.active && (
                            <Link
                              href={`/loans/${l.id}?${
                                l.repaymentMode === "AD_HOC" ? "settle=1" : "pay=1"
                              }`}
                              className={buttonVariants({
                                size: "sm",
                                variant: "outline",
                              })}
                            >
                              {isLent
                                ? "Receive"
                                : l.repaymentMode === "AD_HOC"
                                  ? "Settle"
                                  : "Pay"}
                            </Link>
                          )}
                        </div>
                        {l.principal > 0 && (
                          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary transition-[width]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="rounded-lg border bg-card divide-y">
            {data.loans.length === 0 && (
              <div className="px-5 py-8 text-sm text-muted-foreground text-center">
                No hand loans with this contact yet. Add one under{" "}
                <Link href="/loans/hand" className="underline text-foreground">
                  Hand Loans
                </Link>{" "}
                if you borrowed from them, or{" "}
                <Link
                  href="/loans/hand/lent"
                  className="underline text-foreground"
                >
                  Money lent out
                </Link>{" "}
                if you lent to them.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="attachments" className="space-y-6">
          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold">Documents</h3>
              <p className="text-xs text-muted-foreground">
                ID proofs, agreements, photos and other files kept on{" "}
                {data.member.name}. PDFs and images, up to 25&nbsp;MB each.
              </p>
            </div>
            <AttachmentList
              ownerKind="CONTACT_DOCUMENT"
              ownerId={id ?? ""}
              accept="image/*,application/pdf"
              emptyMessage="No documents yet — upload one above."
            />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">From transactions</h3>
            <ContactAttachmentsPanel
              contactId={id ?? ""}
              onViewTransaction={(txnId) => setDetailTxnId(txnId)}
            />
          </section>
        </TabsContent>

        {data.expenses.length > 0 && (
          <TabsContent value="expenses">
            <p className="text-xs text-muted-foreground mb-2">
              Spent on this contact without marking as recoverable. Informational
              only — not in Outstanding.
            </p>
            <div className="rounded-lg border bg-card divide-y">
              {data.expenses.map((e) => (
                <button
                  type="button"
                  key={e.id}
                  onClick={() => setDetailTxnId(e.id)}
                  className="group flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-muted/40"
                  title="View full transaction details"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate group-hover:underline">
                      {e.description}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {formatDate(e.date)}
                      {e.account ? ` · ${e.account.name}` : ""}
                      {e.kind === "GIFT" ? " · Gift" : ""}
                      {e.isPartialOfTotal
                        ? ` · share of ${formatINR(e.transactionAmount)} total`
                        : ""}
                    </div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums">
                    {formatINR(e.amount)}
                  </div>
                </button>
              ))}
            </div>
          </TabsContent>
        )}

        {(data.paidForMe?.length ?? 0) > 0 && (
          <TabsContent value="paidForMe">
            <p className="text-xs text-muted-foreground mb-2">
              Expenses {data.member.name} paid on your behalf. RECOVERABLE
              rows are mirrored as an obligation under <strong>Charges</strong>;
              GIFT rows are informational only.
            </p>
            <div className="rounded-lg border bg-card divide-y">
              {data.paidForMe!.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setDetailTxnId(p.id)}
                  className="group flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-muted/40"
                  title="View full transaction details"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate group-hover:underline">
                      {p.description}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {formatDate(p.date)}
                      {p.category
                        ? ` · ${
                            p.category.parent
                              ? `${p.category.parent.name} › ${p.category.name}`
                              : p.category.name
                          }`
                        : ""}
                      {p.memberChargeType === "RECOVERABLE"
                        ? " · you owe back"
                        : p.memberChargeType === "GIFT"
                          ? " · gift"
                          : ""}
                    </div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums">
                    {formatINR(p.amount)}
                  </div>
                </button>
              ))}
            </div>
          </TabsContent>
        )}

        {forgivenCharges.length > 0 && (
          <TabsContent value="forgiven">
            <p className="text-xs text-muted-foreground mb-2">
              Charges you wrote off. Any settlements already received against
              them are preserved here for audit; nothing is added back to
              Outstanding.
            </p>
            <div className="rounded-lg border bg-card divide-y">
              {forgivenCharges.map((c) => (
                <div key={c.id} className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {c.origin?.description ?? "Charge"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {c.origin
                          ? formatDate(c.origin.date)
                          : formatDate(c.createdAt)}{" "}
                        · forgiven
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold line-through opacity-60">
                        {formatINR(c.amount)}
                      </div>
                      {c.settledAmount > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Settled before forgive: {formatINR(c.settledAmount)}
                        </div>
                      )}
                    </div>
                  </div>
                  {c.settlements.length > 0 && (
                    <ul className="mt-2 ml-1 border-l pl-3 space-y-1">
                      {c.settlements.map((s) => (
                        <li key={s.id} className="text-xs text-muted-foreground">
                          {formatDate(s.paidAt)} · {formatINR(s.amount)}
                          {s.notes ? ` · ${s.notes}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>
        )}

        {medicalRecords.length > 0 && (
          <TabsContent value="medical">
            <div className="space-y-2">
              <div className="text-right">
                <Link
                  href={`/medical/${id}`}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Full medical history
                </Link>
              </div>
              <div className="rounded-lg border bg-card divide-y">
                {medicalRecords.map((r) => (
                  <Link
                    key={r.id}
                    href={`/medical/records/${r.id}`}
                    className="flex items-start justify-between gap-3 px-5 py-3 hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{r.facilityName}</span>
                        <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {r.kind === "CHECKUP" ? "Checkup" : "Hospitalization"}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.kind === "HOSPITALIZATION"
                          ? `Admitted ${formatDate(r.occurredAt)}${
                              r.dischargedAt
                                ? ` · Discharged ${formatDate(r.dischargedAt)}`
                                : " · Ongoing"
                            }`
                          : `Visited ${formatDate(r.occurredAt)}`}
                        {r.diagnosis ? ` · ${r.diagnosis}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {r.claim && (
                        <span className="rounded-full border px-2 py-0.5 uppercase tracking-wide">
                          claim · {r.claim.status.replace("_", " ").toLowerCase()}
                        </span>
                      )}
                      {r.transactionCount > 0 && (
                        <span>
                          {r.transactionCount} bill{r.transactionCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>

      <TransferDialog
        contactId={id ?? ""}
        contactName={data.member.name}
        direction={transferOpen}
        accounts={accounts}
        onClose={() => setTransferOpen(null)}
      />

      <SettleDialog
        charge={settleCharge}
        accounts={accounts}
        contactName={data.member.name}
        onClose={() => setSettleCharge(null)}
      />

      <TransactionDetailDialog
        transactionId={detailTxnId}
        open={detailTxnId !== null}
        onOpenChange={(o) => !o && setDetailTxnId(null)}
      />

      {bulkSettleDirection && (
        <BulkSettleDialog
          open={!!bulkSettleDirection}
          onOpenChange={(o) => !o && setBulkSettleDirection(null)}
          contactId={id!}
          contactName={data.member.name}
          direction={bulkSettleDirection}
          charges={openCharges.filter(
            (c) => c.direction === bulkSettleDirection && c.status !== "SETTLED",
          )}
          // Their credit clears what they owe; ours clears what we owe.
          advanceAvailable={
            bulkSettleDirection === "OWED_TO_USER"
              ? data.totals.advanceHeld
              : data.totals.advancePaid
          }
          onSaved={() => {
            globalMutate(`/api/contacts/${id}/ledger`);
            mutateBalances();
          }}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-semibold ${highlight ? "text-2xl" : "text-lg"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function SettleDialog({
  charge,
  accounts,
  contactName,
  onClose,
}: {
  charge: Charge | null;
  accounts: Account[];
  contactName: string;
  onClose: () => void;
}) {
  // Settle wording flips with the charge direction:
  //   OWED_TO_USER → contact pays me back  → INCOME  ("Receive")
  //   USER_OWES    → I pay this contact    → EXPENSE ("Pay")
  const isIncoming = charge?.direction !== "USER_OWES";
  const remaining = charge ? charge.amount - charge.settledAmount : 0;
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amtNum = Number(amount) || 0;
  const overpay = amtNum > remaining + 0.01;
  const isPartial = amtNum > 0 && amtNum < remaining - 0.01;

  useEffect(() => {
    if (!charge) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on dialog open */
    setAmount(remaining.toFixed(2));
    setPaidAt(today);
    setAccountId("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [charge, remaining, today]);

  async function submit() {
    if (!charge) return;
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (amt > remaining + 0.01) {
      setError(
        `Amount exceeds ${
          isIncoming ? "what they owe" : "what you owe"
        } (${formatINR(remaining)})`,
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/member-charges/${charge.id}/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          paidAt,
          notes: notes.trim() || undefined,
          accountId: accountId || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        toast.success(isIncoming ? "Payment received" : "Payment recorded");
        await mutateBalances();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={charge !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isIncoming ? `Receive from ${contactName}` : `Pay ${contactName}`}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {isIncoming ? "They owe you" : "You owe them"}:{" "}
          {formatINR(remaining)}.
        </p>
        <div className="space-y-3">
          <label className="block">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Amount (₹)</span>
              {remaining > 0 && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setAmount(remaining.toFixed(2))}
                >
                  Full
                </Button>
              )}
            </div>
            <AmountInput value={amount} onChange={setAmount} autoFocus />
            {overpay ? (
              <p className="mt-1 text-xs text-destructive">
                Exceeds {isIncoming ? "what they owe" : "what you owe"} (
                {formatINR(remaining)}).
              </p>
            ) : isPartial ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Partial {isIncoming ? "receipt" : "payment"} —{" "}
                {formatINR(remaining - amtNum)} stays outstanding.
              </p>
            ) : amtNum > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Settles in full.
              </p>
            ) : null}
          </label>
          <label className="block">
            <span className="text-xs font-medium">
              {isIncoming ? "Received on" : "Paid on"}
            </span>
            <DateInput value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-medium">
              {isIncoming
                ? "Received into account (optional)"
                : "Paid from account (optional)"}
            </span>
            <div className="mt-1">
              <NativeSelect
                value={accountId}
                onChange={setAccountId}
                placeholder={
                  isIncoming
                    ? "— don't create income transaction —"
                    : "— don't create expense transaction —"
                }
                options={groupAccountOptions(accounts, isIncoming ? 0 : Number(amount) || 0)}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isIncoming
                ? `Pick to auto-create an INCOME transaction when ${contactName} pays you back.`
                : `Pick to auto-create an EXPENSE transaction when you pay ${contactName}.`}
            </p>
          </label>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || amtNum <= 0 || overpay}>
            {submitting
              ? "Saving…"
              : isIncoming
                ? "Record receipt"
                : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  contactId,
  contactName,
  direction,
  accounts,
  onClose,
}: {
  contactId: string;
  contactName: string;
  direction: "SEND" | "RECEIVE" | null;
  accounts: Account[];
  onClose: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [expectBack, setExpectBack] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!direction) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset on dialog open */
    setAmount("");
    setDate(today);
    setAccountId("");
    setNotes("");
    setExpectBack(false);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [direction, today]);

  async function submit() {
    if (!direction) return;
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount");
      return;
    }
    if (!accountId) {
      setError(direction === "SEND" ? "Pick an account to send from" : "Pick the receiving account");
      return;
    }
    const body =
      direction === "SEND"
        ? {
            fromAccountId: accountId,
            toContactId: contactId,
            amount: amt,
            date,
            notes: notes.trim() || undefined,
            expectBack,
          }
        : { fromContactId: contactId, toAccountId: accountId, amount: amt, date, notes: notes.trim() || undefined };
    setSubmitting(true);
    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const respBody = await res.json();
      if (!res.ok) setError(respBody.error ?? "Failed");
      else {
        toast.success(direction === "SEND" ? "Transfer sent" : "Transfer received");
        globalMutate(`/api/contacts/${contactId}/ledger`);
        await mutateBalances();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const verb = direction === "SEND" ? "Send to" : "Receive from";
  const accountLabel = direction === "SEND" ? "Send from" : "Receive into";

  return (
    <Dialog open={direction !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {verb} {contactName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Amount (₹)</span>
              <AmountInput value={amount} onChange={setAmount} autoFocus />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Date</span>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">{accountLabel}</span>
            <div className="mt-1">
              <NativeSelect
                value={accountId}
                onChange={setAccountId}
                options={groupAccountOptions(accounts, Number(amount) || 0)}
              />
            </div>
          </label>
          {direction === "SEND" && (
            <label className="flex items-start gap-2.5 cursor-pointer rounded-md border bg-card p-3">
              <input
                type="checkbox"
                checked={expectBack}
                onChange={(e) => setExpectBack(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <div className="space-y-0.5">
                <span className="text-sm font-medium block">
                  Expect this back from {contactName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {expectBack
                    ? "Adds to their Outstanding — settle later from this page."
                    : "Just a transfer, no balance impact."}
                </span>
              </div>
            </label>
          )}
          <label className="block">
            <span className="text-xs font-medium">Notes (optional)</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Record transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
