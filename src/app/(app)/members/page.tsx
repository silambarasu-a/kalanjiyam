"use client";

import Link from "next/link";
import useSWR from "swr";
import { UserCircle2 } from "lucide-react";
import { formatINR } from "@/lib/utils";

type FamilyMember = {
  id: string;
  name: string;
  relationship: string | null;
  active: boolean;
};

type LedgerSummary = {
  member: { id: string; name: string };
  totals: { outstanding: number; settled: number };
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function MemberLedgerPage() {
  const { data, isLoading } = useSWR<{ members: FamilyMember[] }>("/api/family", fetcher);
  const members = (data?.members ?? []).filter((m) => m.active);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Member ledger</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Outstanding balances for each family member. Recoverable charges from expenses tagged
          to them appear here, plus their settlements.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {members.map((m) => (
          <MemberCard key={m.id} member={m} />
        ))}
        {members.length === 0 && !isLoading && (
          <div className="col-span-full rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            Add family members first, then tag expenses to them as &quot;Recover later&quot; to
            populate their ledger.
          </div>
        )}
      </div>
    </div>
  );
}

function MemberCard({ member }: { member: FamilyMember }) {
  const { data } = useSWR<LedgerSummary>(`/api/family/${member.id}/ledger`, fetcher);
  return (
    <Link
      href={`/members/${member.id}`}
      className="rounded-lg border bg-card p-5 hover:bg-accent/40 transition"
    >
      <div className="flex items-center gap-3">
        <UserCircle2 className="h-9 w-9 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{member.name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {member.relationship ?? "—"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Outstanding</div>
          <div className="font-semibold">
            {formatINR(data?.totals.outstanding ?? 0)}
          </div>
        </div>
      </div>
    </Link>
  );
}
