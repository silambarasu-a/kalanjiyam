import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const session = await auth();
  const workspace = session?.user.activeWorkspaceId
    ? await prisma.workspace.findUnique({
        where: { id: session.user.activeWorkspaceId },
        select: { name: true },
      })
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {session?.user.name?.split(" ")[0] ?? "friend"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s an overview of {workspace?.name ?? "your workspace"}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <DashCard label="Net cash this month" value="—" hint="Income minus expense" />
        <DashCard label="Active farm batches" value="0" hint="Crops + livestock in progress" />
        <DashCard label="Upcoming reminders" value="0" hint="Next 14 days" />
        <DashCard label="Pending wages" value="0" hint="Workers with unpaid balance" />
        <DashCard label="Member balances" value="0" hint="Recoverable outstanding" />
        <DashCard label="Card statements due" value="0" hint="In the next 14 days" />
      </div>

      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
        Real dashboard data lights up as domains come online. Schema is live. Try the
        sidebar / bottom-nav; each section shows what&apos;s coming.
      </div>
    </div>
  );
}

function DashCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
