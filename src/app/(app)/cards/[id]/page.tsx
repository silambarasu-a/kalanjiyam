import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessRecord } from "@/lib/permissions";
import { computeAccountBalance } from "@/lib/account-balance";
import { formatINR } from "@/lib/utils";

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const card = await prisma.card.findUnique({
    where: { id },
    include: {
      ownerUser: { select: { name: true } },
      ownerMember: { select: { name: true } },
      parentAccount: { select: { id: true, name: true } },
      account: { select: { id: true, creditLimit: true, statementDate: true, gracePeriod: true } },
    },
  });
  if (!card || card.workspaceId !== session?.user.activeWorkspaceId) notFound();
  if (!canAccessRecord(session, card)) notFound();

  const balance = card.accountId ? await computeAccountBalance(card.accountId) : null;
  const creditLimit =
    card.account?.creditLimit != null ? Number(card.account.creditLimit) : null;
  let outstandingEmi = 0;
  if (card.kind === "CREDIT") {
    const emi = await prisma.loan.aggregate({
      where: { cardId: id, source: "CARD_EMI", active: true },
      _sum: { outstanding: true },
    });
    outstandingEmi = Number(emi._sum.outstanding ?? 0);
  }
  const available =
    creditLimit != null && balance
      ? creditLimit - outstandingEmi - Math.max(0, balance.balance)
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/cards" className="text-xs text-muted-foreground">
          ← Cards
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{card.name}</h1>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {card.kind} · {card.network}
          {card.supportsUpi ? " · UPI" : ""}
          {card.last4 ? ` · ••${card.last4}` : ""}
        </p>
      </div>

      {card.kind === "CREDIT" && creditLimit != null && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Available limit"
            value={formatINR(available ?? creditLimit)}
            highlight
          />
          <Stat label="Credit limit" value={formatINR(creditLimit)} />
          <Stat label="Current statement" value={formatINR(balance?.balance ?? 0)} />
          <Stat label="Active EMI outstanding" value={formatINR(outstandingEmi)} />
        </div>
      )}
      {card.kind === "DEBIT" && card.parentAccount && (
        <div className="rounded-lg border bg-card p-5 text-sm">
          Linked to <Link href={`/accounts/${card.parentAccount.id}`} className="font-semibold underline">
            {card.parentAccount.name}
          </Link>
        </div>
      )}

      <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
        Statement list + transactions on this card appear here as transactions land in M6.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-semibold ${highlight ? "text-2xl" : "text-lg"}`}>{value}</div>
    </div>
  );
}
