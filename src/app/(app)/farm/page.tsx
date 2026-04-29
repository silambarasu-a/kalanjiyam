"use client";

import Link from "next/link";
import useSWR from "swr";
import { Sprout, Beef, FileSignature, HardHat, Wallet2 } from "lucide-react";
import { FarmSubNav } from "@/components/layout/farm-sub-nav";
import { formatINR } from "@/lib/utils";

type FarmOverview = {
  crops: { active: number; total: number };
  livestock: { active: number; head: number };
  leases: { active: number };
  workers: { active: number; owedTotal: number };
  wages: { thisMonthPaid: number; outstandingAdvances: number };
};

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  return r.json();
};

export default function FarmOverviewPage() {
  const { data } = useSWR<FarmOverview>("/api/farm/overview", fetcher);

  return (
    <div className="space-y-6">
      <FarmSubNav />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Farm</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Crops, livestock, leases, and the people working them. Pick a section to
          dive in.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Card
          href="/crops"
          icon={<Sprout className="h-5 w-5 text-primary" />}
          title="Crops"
          primary={data ? `${data.crops.active} active` : "—"}
          secondary={data ? `${data.crops.total} total` : undefined}
        />
        <Card
          href="/livestock"
          icon={<Beef className="h-5 w-5 text-primary" />}
          title="Livestock"
          primary={data ? `${data.livestock.head} head` : "—"}
          secondary={data ? `${data.livestock.active} active batch${data.livestock.active === 1 ? "" : "es"}` : undefined}
        />
        <Card
          href="/leases"
          icon={<FileSignature className="h-5 w-5 text-primary" />}
          title="Leases"
          primary={data ? `${data.leases.active} active` : "—"}
        />
        <Card
          href="/workers"
          icon={<HardHat className="h-5 w-5 text-primary" />}
          title="Workers"
          primary={data ? `${data.workers.active} on roll` : "—"}
          secondary={
            data && data.workers.owedTotal > 0
              ? `${formatINR(data.workers.owedTotal)} owed`
              : undefined
          }
        />
        <Card
          href="/wages"
          icon={<Wallet2 className="h-5 w-5 text-primary" />}
          title="Wages"
          primary={data ? formatINR(data.wages.thisMonthPaid) : "—"}
          secondary={
            data
              ? `paid this month${data.wages.outstandingAdvances > 0 ? ` · ${formatINR(data.wages.outstandingAdvances)} advances out` : ""}`
              : undefined
          }
        />
      </div>
    </div>
  );
}

function Card({
  href,
  icon,
  title,
  primary,
  secondary,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  primary: string;
  secondary?: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        <span>{title}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{primary}</div>
      {secondary && (
        <div className="mt-0.5 text-xs text-muted-foreground">{secondary}</div>
      )}
    </Link>
  );
}
