import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessRecord } from "@/lib/permissions";
import { formatINR, formatDate } from "@/lib/utils";
import {
  InvestmentTransactionHistory,
  type InvestmentTxnRow,
} from "@/components/investments/investment-transaction-history";
import { InvestmentActions } from "@/components/investments/investment-actions";

const KIND_LABEL: Record<string, string> = {
  STOCK: "Stock",
  MUTUAL_FUND: "Mutual fund",
  FD: "Fixed deposit",
  RD: "Recurring deposit",
  SIP: "SIP",
  INSURANCE: "Insurance",
  GOLD: "Gold",
  OTHER: "Other",
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

const FREQUENCY_LABEL: Record<string, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly",
  ONE_TIME: "One-time",
};

export default async function InvestmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const inv = await prisma.investment.findUnique({
    where: { id },
    include: {
      ownerUser: { select: { name: true } },
    },
  });
  if (!inv || inv.workspaceId !== session?.user.activeWorkspaceId) notFound();
  if (!canAccessRecord(session, inv)) notFound();

  // Stocks already have a richer dedicated surface — send the user there
  // instead of duplicating buy/sell tables here.
  if (inv.kind === "STOCK") redirect(`/investments/stocks/${inv.id}`);

  const [transactions, reminders] = await Promise.all([
    prisma.transaction.findMany({
      where: { investmentId: id, workspaceId: inv.workspaceId },
      orderBy: { date: "desc" },
      take: 50,
      select: {
        id: true,
        amount: true,
        description: true,
        date: true,
        type: true,
        investmentAction: true,
        account: { select: { id: true, name: true, kind: true } },
        card: { select: { id: true, name: true, last4: true } },
      },
    }),
    prisma.investmentReminder.findMany({
      where: { investmentId: id, status: "UPCOMING" },
      orderBy: { dueDate: "asc" },
      take: 12,
    }),
  ]);

  const amount = Number(inv.amount);
  const currentValue = inv.currentValue != null ? Number(inv.currentValue) : null;
  const premiumAmount =
    inv.premiumAmount != null ? Number(inv.premiumAmount) : null;
  const sumAssured =
    inv.sumAssured != null ? Number(inv.sumAssured) : null;
  const interestRate =
    inv.interestRate != null ? Number(inv.interestRate) : null;

  const totalPaid = transactions
    .filter((t) => t.type === "EXPENSE" || t.investmentAction === "BUY")
    .reduce((s, t) => s + Number(t.amount), 0);

  const today = new Date();
  const daysToMaturity =
    inv.maturityAt
      ? Math.round(
          (inv.maturityAt.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
        )
      : null;
  const daysToNextDue =
    inv.nextDueDate
      ? Math.round(
          (inv.nextDueDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
        )
      : null;

  // Status badge: insurance status when present, else open/closed flag.
  const statusInfo: { label: string; tone: string } = (() => {
    if (inv.kind === "INSURANCE" && inv.insuranceStatus) {
      switch (inv.insuranceStatus) {
        case "ACTIVE":
          return { label: "Active", tone: "text-primary" };
        case "LAPSED":
          return { label: "Lapsed", tone: "text-destructive" };
        case "MATURED":
          return {
            label: "Matured",
            tone: "text-emerald-700 dark:text-emerald-400",
          };
        case "SURRENDERED":
          return { label: "Surrendered", tone: "text-muted-foreground" };
        case "CLAIMED":
          return {
            label: "Claimed",
            tone: "text-emerald-700 dark:text-emerald-400",
          };
      }
    }
    if (!inv.active) return { label: "Closed", tone: "text-muted-foreground" };
    return { label: "Active", tone: "text-primary" };
  })();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/investments" className="text-xs text-muted-foreground">
          ← Investments
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{inv.name}</h1>
          <span
            className={`text-[10px] font-semibold uppercase tracking-widest ${statusInfo.tone}`}
          >
            {statusInfo.label}
          </span>
          {inv.lockedUntil &&
            // eslint-disable-next-line react-hooks/purity -- server component, evaluated once per request
            inv.lockedUntil.getTime() > Date.now() && (
            <span
              className="text-[10px] font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400"
              title={`Locked until ${formatDate(inv.lockedUntil)} — only the workspace owner can edit or delete.`}
            >
              Locked · {formatDate(inv.lockedUntil)}
            </span>
          )}
          <InvestmentActions
            investment={{ id: inv.id, name: inv.name }}
            redirectAfterDelete="/investments"
            className="ml-auto flex items-center gap-1"
          />
        </div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {KIND_LABEL[inv.kind] ?? inv.kind}
          {inv.institution ? ` · ${inv.institution}` : ""}
        </p>
      </div>

      <section className="rounded-2xl border bg-linear-to-br from-card to-muted/40 p-5 sm:p-6">
        <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {currentValue != null ? "Current value" : "Amount invested"}
            </div>
            <div className="mt-1 text-4xl font-bold tabular-nums">
              {formatINR(currentValue ?? amount)}
            </div>
            {currentValue != null && currentValue !== amount && (
              <div
                className={`mt-0.5 text-xs tabular-nums ${
                  currentValue > amount
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-destructive"
                }`}
              >
                {currentValue > amount ? "+" : "−"}
                {formatINR(Math.abs(currentValue - amount))} ·{" "}
                {((Math.abs(currentValue - amount) / amount) * 100).toFixed(1)}%
              </div>
            )}
            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {formatINR(amount)} principal
              {totalPaid > amount
                ? ` · ${formatINR(totalPaid)} paid in`
                : ""}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:gap-4 md:grid-cols-1 md:grid-rows-3">
            <SubStat label="Started" value={formatDate(inv.startedAt)} />
            <SubStat
              label={inv.kind === "INSURANCE" ? "Maturity / expiry" : "Maturity"}
              value={
                inv.maturityAt
                  ? `${formatDate(inv.maturityAt)}${
                      daysToMaturity != null && daysToMaturity > 0
                        ? ` · ${daysToMaturity}d`
                        : daysToMaturity != null && daysToMaturity <= 0
                          ? " · due"
                          : ""
                    }`
                  : "—"
              }
            />
            <SubStat
              label="Next due"
              value={
                inv.nextDueDate
                  ? `${formatDate(inv.nextDueDate)}${
                      daysToNextDue != null && daysToNextDue > 0
                        ? ` · in ${daysToNextDue}d`
                        : daysToNextDue != null && daysToNextDue <= 0
                          ? " · overdue"
                          : ""
                    }`
                  : "—"
              }
            />
          </div>
        </div>
      </section>

      {inv.kind === "INSURANCE" && (
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold">Policy</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {inv.policyType && (
              <Row
                label="Policy type"
                value={POLICY_TYPE_LABEL[inv.policyType] ?? inv.policyType}
              />
            )}
            {inv.policyNumber && (
              <Row label="Policy number" value={inv.policyNumber} />
            )}
            {sumAssured != null && (
              <Row label="Sum assured" value={formatINR(sumAssured)} />
            )}
            {premiumAmount != null && (
              <Row
                label="Premium"
                value={
                  inv.premiumFrequency
                    ? `${formatINR(premiumAmount)} · ${
                        FREQUENCY_LABEL[inv.premiumFrequency] ?? inv.premiumFrequency
                      }`
                    : formatINR(premiumAmount)
                }
              />
            )}
            {inv.nominee && <Row label="Nominee" value={inv.nominee} />}
            {inv.insuranceStatus && (
              <Row label="Status" value={statusInfo.label} />
            )}
          </dl>
          {inv.notes && (
            <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">
              {inv.notes}
            </p>
          )}
        </section>
      )}

      {(inv.kind === "FD" || inv.kind === "RD") && (
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold">
            {inv.kind === "FD" ? "Deposit" : "Recurring deposit"}
          </h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Principal" value={formatINR(amount)} />
            {interestRate != null && (
              <Row label="Interest rate" value={`${interestRate}% p.a.`} />
            )}
            {inv.compoundingFrequency && (
              <Row
                label="Compounding"
                value={FREQUENCY_LABEL[inv.compoundingFrequency] ?? inv.compoundingFrequency}
              />
            )}
            {inv.fdStatus && <Row label="Status" value={inv.fdStatus} />}
            {inv.maturityAt && (
              <Row
                label="Matures on"
                value={`${formatDate(inv.maturityAt)}${
                  daysToMaturity != null && daysToMaturity > 0
                    ? ` · in ${daysToMaturity} days`
                    : ""
                }`}
              />
            )}
          </dl>
          {inv.notes && (
            <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">
              {inv.notes}
            </p>
          )}
        </section>
      )}

      {inv.kind === "SIP" && (
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold">SIP</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {premiumAmount != null && (
              <Row
                label="Instalment"
                value={
                  inv.premiumFrequency
                    ? `${formatINR(premiumAmount)} · ${
                        FREQUENCY_LABEL[inv.premiumFrequency] ?? inv.premiumFrequency
                      }`
                    : formatINR(premiumAmount)
                }
              />
            )}
            {interestRate != null && (
              <Row label="Expected return" value={`${interestRate}% p.a.`} />
            )}
            <Row label="Total invested so far" value={formatINR(totalPaid)} />
          </dl>
          {inv.notes && (
            <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">
              {inv.notes}
            </p>
          )}
        </section>
      )}

      {(inv.kind === "GOLD" || inv.kind === "MUTUAL_FUND" || inv.kind === "OTHER") &&
        inv.notes && (
          <section className="rounded-lg border bg-card p-5">
            <h2 className="text-sm font-semibold">Notes</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm">{inv.notes}</p>
          </section>
        )}

      {reminders.length > 0 && (
        <section className="rounded-lg border bg-card">
          <header className="px-5 py-3 border-b">
            <h2 className="text-sm font-semibold">Upcoming dues</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {reminders.length} upcoming · confirm via /reminders
            </p>
          </header>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b bg-muted/30">
                <th className="px-5 py-2">Due</th>
                <th className="px-5 py-2">Kind</th>
                <th className="px-5 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {reminders.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-5 py-2 text-muted-foreground whitespace-nowrap tabular-nums">
                    {formatDate(r.dueDate)}
                  </td>
                  <td className="px-5 py-2 text-xs text-muted-foreground">
                    {r.kind}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums">
                    {r.amount != null ? formatINR(Number(r.amount)) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      )}

      <InvestmentTransactionHistory
        transactions={transactions.map<InvestmentTxnRow>((t) => ({
          id: t.id,
          type: t.type,
          investmentAction: t.investmentAction,
          amount: Number(t.amount),
          date: t.date.toISOString(),
          description: t.description,
          account: t.account,
          card: t.card,
        }))}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed border-border/60 py-1.5 last:border-0">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}

function SubStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums truncate">{value}</div>
    </div>
  );
}
