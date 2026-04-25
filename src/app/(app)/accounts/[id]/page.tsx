import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessRecord } from "@/lib/permissions";
import { computeAccountBalance } from "@/lib/account-balance";
import { formatINR } from "@/lib/utils";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const account = await prisma.account.findUnique({
    where: { id },
    include: {
      ownerUser: { select: { name: true, email: true } },
      ownerMember: { select: { name: true } },
    },
  });
  if (!account || account.workspaceId !== session?.user.activeWorkspaceId) notFound();
  if (!canAccessRecord(session, account)) notFound();
  const balance = await computeAccountBalance(account.id);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/accounts" className="text-xs text-muted-foreground">
          ← Accounts
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{account.name}</h1>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {account.kind}
          {account.ownerMember ? ` · ${account.ownerMember.name}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Balance" value={formatINR(balance.balance)} highlight />
        <Stat label="Opening" value={formatINR(balance.openingBalance)} />
        <Stat label="Income" value={formatINR(balance.income)} />
        <Stat label="Expense" value={formatINR(balance.expense)} />
      </div>

      <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
        Transaction history shows up here once the unified transaction dialog lands in M6.
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
