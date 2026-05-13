"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { ArrowLeft, Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { InsurerPicker } from "@/components/ui/insurer-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatINR, formatDate } from "@/lib/utils";

type Contact = { id: string; name: string; relationship: string | null };

type Member = {
  id: string;
  contactId: string;
  contact: Contact;
  premiumAmount: number | null;
  premiumFrequency: string | null;
  sumAssured: number | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  active: boolean;
  notes: string | null;
  role: "INSURED" | "BENEFICIARY";
  sharePercent: number | null;
};

type Claim = {
  id: string;
  claimNumber: string | null;
  incidentDate: string;
  filedAt: string | null;
  status: string;
  claimedAmount: number | null;
  approvedAmount: number | null;
  receivedAmount: number | null;
  notes: string | null;
  insuredMember: { id: string; contactId: string; contactName: string } | null;
  transactionCount: number;
};

type Reminder = {
  id: string;
  kind: string;
  dueDate: string;
  amount: number | null;
  status: string;
};

type Policy = {
  id: string;
  kind: string;
  name: string;
  institution: string | null;
  policyNumber: string | null;
  policyType: string | null;
  insuranceStatus: string | null;
  premiumAmount: number | null;
  premiumFrequency: string | null;
  sumAssured: number | null;
  nextDueDate: string | null;
  nominee: string | null;
  startedAt: string;
  maturityAt: string | null;
  active: boolean;
  notes: string | null;
  policyTermYears: number | null;
  premiumPayingTermYears: number | null;
  maturityValue: number | null;
  bonusAccrued: number | null;
  bonusLastRevisedAt: string | null;
  renewedFromInvestmentId: string | null;
  renewedFrom: ChainLink | null;
  successors: ChainLink[];
};

type ChainLink = {
  id: string;
  name: string;
  policyNumber: string | null;
  insuranceStatus: string | null;
  startedAt: string;
  nextDueDate: string | null;
};

function isLifeFamily(t: string | null): boolean {
  return t === "LIFE" || t === "TERM" || t === "ULIP" || t === "ENDOWMENT";
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const FREQUENCIES = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "ONE_TIME"];

const CLAIM_STATUSES = [
  "FILED",
  "INTIMATED",
  "UNDER_REVIEW",
  "APPROVED",
  "PARTIALLY_APPROVED",
  "REJECTED",
  "PAID",
  "CLOSED",
];

export default function InsuranceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [tab, setTab] = useState<"members" | "premiums" | "claims">("members");
  const [editOpen, setEditOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const router = useRouter();

  const policyKey = `/api/investments/${id}`;
  const membersKey = `/api/insurance/${id}/members`;
  const claimsKey = `/api/insurance/${id}/claims`;

  const { data: pData, isLoading: pLoading } = useSWR<{
    investment: Policy;
    reminders: Reminder[];
  }>(policyKey, fetcher);
  const { data: mData } = useSWR<{ members: Member[] }>(membersKey, fetcher);
  const { data: cData } = useSWR<{ claims: Claim[] }>(claimsKey, fetcher);

  const policy = pData?.investment;
  const reminders = pData?.reminders ?? [];
  const members = mData?.members ?? [];
  const claims = cData?.claims ?? [];

  if (pLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!policy)
    return (
      <p className="text-sm text-muted-foreground">
        Policy not found.{" "}
        <Link href="/insurance" className="underline">
          Back to insurance
        </Link>
      </p>
    );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/insurance"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All policies
        </Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight truncate">
                {policy.name}
              </h1>
              {policy.insuranceStatus === "RENEWED" && (
                <span className="rounded-full border bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Renewed
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {policy.institution ?? "—"}
              {policy.policyType ? ` · ${policy.policyType}` : ""}
              {policy.policyNumber ? ` · ${policy.policyNumber}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditOpen(true)}
              className="gap-1"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRenewOpen(true)}
              className="gap-1"
              disabled={policy.insuranceStatus === "RENEWED"}
              title={
                policy.insuranceStatus === "RENEWED"
                  ? "This policy was already renewed"
                  : "Renew policy"
              }
            >
              <RefreshCw className="h-3.5 w-3.5" /> Renew
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => deletePolicy(id, policy.name, router)}
              title="Delete policy"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </div>

      {/* Header summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCell
          label="Premium"
          value={
            policy.premiumAmount != null
              ? `${formatINR(policy.premiumAmount)} · ${policy.premiumFrequency?.toLowerCase() ?? "—"}`
              : "—"
          }
        />
        <SummaryCell
          label="Sum assured"
          value={policy.sumAssured != null ? formatINR(policy.sumAssured) : "—"}
        />
        <SummaryCell
          label="Next due"
          value={policy.nextDueDate ? formatDate(policy.nextDueDate) : "—"}
        />
        <SummaryCell label="Status" value={policy.insuranceStatus ?? "—"} />
      </div>

      {isLifeFamily(policy.policyType) &&
        (policy.policyTermYears ||
          policy.premiumPayingTermYears ||
          policy.maturityValue ||
          policy.bonusAccrued ||
          policy.maturityAt) && (
          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Policy schedule
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <ScheduleCell
                label="Policy term"
                value={
                  policy.policyTermYears != null ? `${policy.policyTermYears} yr` : "—"
                }
              />
              <ScheduleCell
                label="Premium term"
                value={
                  policy.premiumPayingTermYears != null
                    ? `${policy.premiumPayingTermYears} yr`
                    : "—"
                }
              />
              <ScheduleCell
                label="Maturity value"
                value={
                  policy.maturityValue != null ? formatINR(policy.maturityValue) : "—"
                }
              />
              <ScheduleCell
                label="Bonus accrued"
                value={
                  policy.bonusAccrued != null ? formatINR(policy.bonusAccrued) : "—"
                }
              />
            </div>
          </div>
        )}

      <div className="flex gap-2 border-b">
        {[
          {
            v: "members" as const,
            l: `${isLifeFamily(policy.policyType) ? "Beneficiaries" : "Covered members"}${members.length ? ` (${members.length})` : ""}`,
          },
          { v: "premiums" as const, l: `Premiums${reminders.length ? ` (${reminders.length})` : ""}` },
          { v: "claims" as const, l: `Claims${claims.length ? ` (${claims.length})` : ""}` },
        ].map((t) => (
          <button
            key={t.v}
            onClick={() => setTab(t.v)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t.v
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {tab === "members" && (
        <MembersPanel
          policyId={id}
          members={members}
          membersKey={membersKey}
          policyType={policy.policyType}
        />
      )}
      {tab === "premiums" && (
        <PremiumsPanel policy={policy} reminders={reminders} />
      )}
      {tab === "claims" && (
        <ClaimsPanel
          policyId={id}
          claims={claims}
          claimsKey={claimsKey}
          members={members}
        />
      )}

      {(policy.renewedFrom || policy.successors.length > 0) && (
        <ChainSection
          renewedFrom={policy.renewedFrom}
          successors={policy.successors}
        />
      )}

      <EditPolicyDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        policy={policy}
      />
      <RenewDialog
        open={renewOpen}
        onClose={() => setRenewOpen(false)}
        policyId={id}
        policy={policy}
        memberCount={members.length}
      />
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function ScheduleCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-medium tabular-nums">{value}</div>
    </div>
  );
}

/* ---------------- Members panel ---------------- */

function MembersPanel({
  policyId,
  members,
  membersKey,
  policyType,
}: {
  policyId: string;
  members: Member[];
  membersKey: string;
  policyType: string | null;
}) {
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const life = isLifeFamily(policyType);
  const totalShare = members
    .filter((m) => m.role === "BENEFICIARY")
    .reduce((a, m) => a + (m.sharePercent ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {life
            ? "Beneficiaries receive the benefit on maturity / claim. Shares must sum to ≤ 100%."
            : "Anyone covered under this policy. Per-member premium & sum-assured are optional — when blank, the policy values apply."}
        </p>
        <Button onClick={() => setEditing("new")} size="sm" className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Add {life ? "beneficiary" : "member"}
        </Button>
      </div>
      {life && members.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Beneficiary share allocated: {totalShare.toFixed(2)}%
          {totalShare > 100 ? " (over-allocated!)" : ""}
        </p>
      )}
      <div className="rounded-lg border bg-card divide-y">
        {members.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            No {life ? "beneficiaries" : "members"} added yet.
          </p>
        )}
        {members.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            onEdit={() => setEditing(m)}
            policyId={policyId}
            membersKey={membersKey}
          />
        ))}
      </div>
      <MemberDialog
        open={editing !== null}
        member={editing === "new" ? null : editing}
        policyId={policyId}
        membersKey={membersKey}
        policyType={policyType}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function MemberRow({
  member,
  onEdit,
  policyId,
  membersKey,
}: {
  member: Member;
  onEdit: () => void;
  policyId: string;
  membersKey: string;
}) {
  async function remove() {
    if (!confirm(`Remove ${member.contact.name} from this policy?`)) return;
    const res = await fetch(`/api/insurance/${policyId}/members/${member.id}`, {
      method: "DELETE",
    });
    if (res.ok) globalMutate(membersKey);
  }
  return (
    <div className="flex items-start justify-between gap-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{member.contact.name}</span>
          {member.role === "BENEFICIARY" && (
            <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              Beneficiary
            </span>
          )}
        </div>
        {member.contact.relationship && (
          <div className="text-xs text-muted-foreground">
            {member.contact.relationship}
          </div>
        )}
      </div>
      <div className="flex items-start gap-2">
        <div className="text-right text-sm">
          {member.role === "BENEFICIARY" ? (
            <div className="font-medium">
              {member.sharePercent != null ? `${member.sharePercent}%` : "—"}
            </div>
          ) : member.premiumAmount != null ? (
            <div className="font-medium">{formatINR(member.premiumAmount)}</div>
          ) : (
            <div className="text-xs text-muted-foreground">Shared premium</div>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onEdit} title="Edit">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={remove} title="Remove">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function MemberDialog({
  open,
  member,
  policyId,
  membersKey,
  policyType,
  onClose,
}: {
  open: boolean;
  member: Member | null;
  policyId: string;
  membersKey: string;
  policyType: string | null;
  onClose: () => void;
}) {
  const { data: contactsData } = useSWR<{ members: { id: string; name: string }[] }>(
    open ? "/api/contacts" : null,
    fetcher,
  );
  const contacts = contactsData?.members ?? [];
  const life = isLifeFamily(policyType);

  const [contactId, setContactId] = useState<string>("");
  const [premiumAmount, setPremiumAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [role, setRole] = useState<"INSURED" | "BENEFICIARY">("INSURED");
  const [sharePercent, setSharePercent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form on dialog open */
    setContactId(member?.contactId ?? "");
    setPremiumAmount(member?.premiumAmount != null ? String(member.premiumAmount) : "");
    setNotes(member?.notes ?? "");
    setRole(member?.role ?? (life ? "BENEFICIARY" : "INSURED"));
    setSharePercent(member?.sharePercent != null ? String(member.sharePercent) : "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, member, life]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      // Frequency / sum assured / coverage dates are now inherited from
      // the policy — we don't send per-member overrides for them. Only
      // premium (and beneficiary share %) varies per member.
      const payload: Record<string, unknown> = {
        contactId,
        premiumAmount: premiumAmount ? Number(premiumAmount) : undefined,
        notes: notes.trim() || undefined,
        role,
        sharePercent:
          role === "BENEFICIARY" && sharePercent ? Number(sharePercent) : undefined,
      };
      const url = member
        ? `/api/insurance/${policyId}/members/${member.id}`
        : `/api/insurance/${policyId}/members`;
      const res = await fetch(url, {
        method: member ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate(membersKey);
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {member
              ? `Edit ${role === "BENEFICIARY" ? "beneficiary" : "member"}`
              : `Add ${life ? "beneficiary" : "covered member"}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {life && (
            <label className="block">
              <span className="text-xs font-medium">Role</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value as "INSURED" | "BENEFICIARY")}
              >
                <option value="BENEFICIARY">Beneficiary (receives benefit)</option>
                <option value="INSURED">Insured (life covered)</option>
              </select>
            </label>
          )}
          <label className="block">
            <span className="text-xs font-medium">Contact</span>
            <select
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              disabled={!!member}
            >
              <option value="">Select contact…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {contacts.length === 0 && !member && (
              <p className="mt-1 text-xs text-muted-foreground">
                No contacts yet.{" "}
                <Link href="/contacts" className="underline">
                  Add family members on Contacts
                </Link>
                , then come back.
              </p>
            )}
          </label>
          {role === "BENEFICIARY" ? (
            <label className="block">
              <span className="text-xs font-medium">Share %</span>
              <Input
                inputMode="decimal"
                value={sharePercent}
                onChange={(e) => setSharePercent(e.target.value)}
                placeholder="e.g. 50"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Portion of the benefit this beneficiary receives. All beneficiaries on
                a policy must sum to ≤ 100%.
              </p>
            </label>
          ) : (
            <label className="block">
              <span className="text-xs font-medium">
                Premium per cycle{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <AmountInput
                value={premiumAmount}
                onChange={setPremiumAmount}
                placeholder="0"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Leave blank to use the policy&apos;s shared premium. Frequency,
                sum assured, and coverage dates are inherited from the policy.
              </p>
            </label>
          )}
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !contactId}>
            {member ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Premiums panel ---------------- */

function PremiumsPanel({
  policy,
  reminders,
}: {
  policy: Policy;
  reminders: Reminder[];
}) {
  const today = new Date();
  const upcoming = reminders.filter((r) => r.status === "UPCOMING");
  const confirmed = reminders.filter((r) => r.status === "CONFIRMED");
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Renewal
        </div>
        <div className="mt-1 text-sm">
          {policy.maturityAt
            ? `Maturity / expiry: ${formatDate(policy.maturityAt)}`
            : "No maturity / expiry on record."}
        </div>
        {policy.nextDueDate && (
          <div className="mt-1 text-sm text-muted-foreground">
            Next premium {formatDate(policy.nextDueDate)}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Upcoming ({upcoming.length})</h3>
        <div className="rounded-lg border bg-card divide-y">
          {upcoming.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No upcoming premiums.</p>
          )}
          {upcoming.map((r) => {
            const overdue = new Date(r.dueDate) < today;
            return (
              <div key={r.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <div className={overdue ? "text-amber-600 dark:text-amber-400" : ""}>
                    {formatDate(r.dueDate)}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.kind}</div>
                </div>
                <div className="font-medium">
                  {r.amount != null ? formatINR(r.amount) : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {confirmed.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">Paid ({confirmed.length})</h3>
          <div className="rounded-lg border bg-card divide-y">
            {confirmed.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-3 text-sm">
                <div>{formatDate(r.dueDate)}</div>
                <div>{r.amount != null ? formatINR(r.amount) : "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Claims panel ---------------- */

function ClaimsPanel({
  policyId,
  claims,
  claimsKey,
  members,
}: {
  policyId: string;
  claims: Claim[];
  claimsKey: string;
  members: Member[];
}) {
  const [editing, setEditing] = useState<Claim | "new" | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Claims filed against this policy. Add an incident, track its status, and link
          related hospital / repair transactions to the claim.
        </p>
        <Button onClick={() => setEditing("new")} size="sm" className="gap-1">
          <Plus className="h-3.5 w-3.5" /> File claim
        </Button>
      </div>
      <div className="rounded-lg border bg-card divide-y">
        {claims.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No claims filed.</p>
        )}
        {claims.map((c) => (
          <ClaimRow key={c.id} claim={c} onEdit={() => setEditing(c)} />
        ))}
      </div>
      <ClaimDialog
        open={editing !== null}
        claim={editing === "new" ? null : editing}
        policyId={policyId}
        claimsKey={claimsKey}
        members={members}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function ClaimRow({ claim, onEdit }: { claim: Claim; onEdit: () => void }) {
  return (
    <button
      onClick={onEdit}
      className="flex w-full items-start justify-between gap-3 p-4 text-left hover:bg-muted/40"
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">
            {claim.claimNumber ?? `Incident ${formatDate(claim.incidentDate)}`}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {claim.status.replace("_", " ")}
          </span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {claim.insuredMember
            ? `For ${claim.insuredMember.contactName}`
            : "No member assigned"}
          {claim.filedAt ? ` · Filed ${formatDate(claim.filedAt)}` : ""}
        </div>
        {claim.transactionCount > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            {claim.transactionCount} linked transaction{claim.transactionCount === 1 ? "" : "s"}
          </div>
        )}
      </div>
      <div className="text-right text-sm">
        {claim.claimedAmount != null && (
          <div className="text-xs text-muted-foreground">
            Claimed {formatINR(claim.claimedAmount)}
          </div>
        )}
        {claim.approvedAmount != null && (
          <div className="text-xs text-muted-foreground">
            Approved {formatINR(claim.approvedAmount)}
          </div>
        )}
        {claim.receivedAmount != null && (
          <div className="font-medium">{formatINR(claim.receivedAmount)}</div>
        )}
      </div>
    </button>
  );
}

function ClaimDialog({
  open,
  claim,
  policyId,
  claimsKey,
  members,
  onClose,
}: {
  open: boolean;
  claim: Claim | null;
  policyId: string;
  claimsKey: string;
  members: Member[];
  onClose: () => void;
}) {
  const [insuredMemberId, setInsuredMemberId] = useState<string>("");
  const [claimNumber, setClaimNumber] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [filedAt, setFiledAt] = useState("");
  const [status, setStatus] = useState<string>("FILED");
  const [claimedAmount, setClaimedAmount] = useState("");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form on dialog open */
    setInsuredMemberId(claim?.insuredMember?.id ?? "");
    setClaimNumber(claim?.claimNumber ?? "");
    setIncidentDate(claim?.incidentDate ? claim.incidentDate.slice(0, 10) : "");
    setFiledAt(claim?.filedAt ? claim.filedAt.slice(0, 10) : "");
    setStatus(claim?.status ?? "FILED");
    setClaimedAmount(claim?.claimedAmount != null ? String(claim.claimedAmount) : "");
    setApprovedAmount(claim?.approvedAmount != null ? String(claim.approvedAmount) : "");
    setReceivedAmount(claim?.receivedAmount != null ? String(claim.receivedAmount) : "");
    setNotes(claim?.notes ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, claim]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        insuredMemberId: insuredMemberId || undefined,
        claimNumber: claimNumber.trim() || undefined,
        incidentDate,
        filedAt: filedAt || undefined,
        status,
        claimedAmount: claimedAmount ? Number(claimedAmount) : undefined,
        approvedAmount: approvedAmount ? Number(approvedAmount) : undefined,
        receivedAmount: receivedAmount ? Number(receivedAmount) : undefined,
        notes: notes.trim() || undefined,
      };
      const url = claim
        ? `/api/insurance/${policyId}/claims/${claim.id}`
        : `/api/insurance/${policyId}/claims`;
      const res = await fetch(url, {
        method: claim ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate(claimsKey);
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    if (!claim) return;
    if (!confirm("Delete this claim?")) return;
    const res = await fetch(`/api/insurance/${policyId}/claims/${claim.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      globalMutate(claimsKey);
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{claim ? "Edit claim" : "File a claim"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Covered member</span>
            <select
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={insuredMemberId}
              onChange={(e) => setInsuredMemberId(e.target.value)}
            >
              <option value="">— (none / policyholder)</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.contact.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Claim # (optional)</span>
              <Input
                value={claimNumber}
                onChange={(e) => setClaimNumber(e.target.value)}
                maxLength={80}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Status</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {CLAIM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Incident date</span>
              <DateInput
                value={incidentDate}
                onChange={(e) => setIncidentDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Filed on</span>
              <DateInput value={filedAt} onChange={(e) => setFiledAt(e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Claimed</span>
              <AmountInput value={claimedAmount} onChange={setClaimedAmount} placeholder="0" />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Approved</span>
              <AmountInput value={approvedAmount} onChange={setApprovedAmount} placeholder="0" />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Received</span>
              <AmountInput value={receivedAmount} onChange={setReceivedAmount} placeholder="0" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="flex !justify-between">
          <div>
            {claim && (
              <Button variant="ghost" onClick={remove}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={submitting || !incidentDate}>
              {claim ? "Save" : "File"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Delete helper ---------------- */

async function deletePolicy(
  id: string,
  name: string,
  router: ReturnType<typeof useRouter>,
) {
  if (
    !confirm(
      `Delete "${name}"? This will also remove its members, claims, reminders, and any linked premium transactions. This cannot be undone.`,
    )
  )
    return;
  const res = await fetch(`/api/investments/${id}`, { method: "DELETE" });
  if (res.ok) {
    globalMutate("/api/insurance");
    router.push("/insurance");
  } else {
    const body = await res.json().catch(() => ({}));
    alert(body.error ?? "Failed to delete policy");
  }
}

/* ---------------- Renewal chain section ---------------- */

function ChainSection({
  renewedFrom,
  successors,
}: {
  renewedFrom: ChainLink | null;
  successors: ChainLink[];
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Renewal history
      </div>
      <div className="mt-2 space-y-2 text-sm">
        {renewedFrom && (
          <div>
            <div className="text-xs text-muted-foreground">Renewed from:</div>
            <Link
              href={`/insurance/${renewedFrom.id}`}
              className="font-medium underline"
            >
              {renewedFrom.name}
              {renewedFrom.policyNumber ? ` · ${renewedFrom.policyNumber}` : ""}
            </Link>
            <span className="ml-2 text-xs text-muted-foreground">
              started {formatDate(renewedFrom.startedAt)}
            </span>
          </div>
        )}
        {successors.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground">Renewed into:</div>
            <ul className="space-y-1">
              {successors.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/insurance/${s.id}`}
                    className="font-medium underline"
                  >
                    {s.name}
                    {s.policyNumber ? ` · ${s.policyNumber}` : ""}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">
                    started {formatDate(s.startedAt)} ·{" "}
                    {s.insuranceStatus?.toLowerCase() ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Edit policy dialog ---------------- */

const POLICY_TYPES = [
  { value: "HEALTH", label: "Health" },
  { value: "LIFE", label: "Life" },
  { value: "VEHICLE", label: "Vehicle" },
  { value: "TERM", label: "Term" },
  { value: "ULIP", label: "ULIP" },
  { value: "ENDOWMENT", label: "Endowment" },
  { value: "HOME", label: "Home" },
  { value: "TRAVEL", label: "Travel" },
  { value: "OTHER", label: "Other" },
];

function EditPolicyDialog({
  open,
  onClose,
  policy,
}: {
  open: boolean;
  onClose: () => void;
  policy: Policy;
}) {
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [policyType, setPolicyType] = useState<string>("HEALTH");
  const [premiumAmount, setPremiumAmount] = useState("");
  const [premiumFrequency, setPremiumFrequency] = useState("YEARLY");
  const [sumAssured, setSumAssured] = useState("");
  const [nextDueDate, setNextDueDate] = useState("");
  const [maturityAt, setMaturityAt] = useState("");
  const [nominee, setNominee] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- prefill from server data on open */
    setName(policy.name);
    setInstitution(policy.institution ?? "");
    setPolicyNumber(policy.policyNumber ?? "");
    setPolicyType(policy.policyType ?? "OTHER");
    setPremiumAmount(policy.premiumAmount != null ? String(policy.premiumAmount) : "");
    setPremiumFrequency(policy.premiumFrequency ?? "YEARLY");
    setSumAssured(policy.sumAssured != null ? String(policy.sumAssured) : "");
    setNextDueDate(policy.nextDueDate ? policy.nextDueDate.slice(0, 10) : "");
    setMaturityAt(policy.maturityAt ? policy.maturityAt.slice(0, 10) : "");
    setNominee(policy.nominee ?? "");
    setNotes(policy.notes ?? "");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, policy]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        institution: institution.trim() || null,
        policyNumber: policyNumber.trim() || null,
        policyType,
        premiumAmount: premiumAmount ? Number(premiumAmount) : null,
        premiumFrequency: premiumFrequency || null,
        sumAssured: sumAssured ? Number(sumAssured) : null,
        nextDueDate: nextDueDate || null,
        maturityAt: maturityAt || null,
        nominee: nominee.trim() || null,
        notes: notes.trim() || null,
      };
      const res = await fetch(`/api/investments/${policy.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      globalMutate(`/api/investments/${policy.id}`);
      globalMutate("/api/insurance");
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit policy</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Type</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={policyType}
                onChange={(e) => setPolicyType(e.target.value)}
              >
                {POLICY_TYPES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium">Policy #</span>
              <Input
                value={policyNumber}
                onChange={(e) => setPolicyNumber(e.target.value)}
                maxLength={80}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Insurer</span>
            <InsurerPicker value={institution} onChange={setInstitution} />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Plan name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Premium per cycle</span>
              <AmountInput
                value={premiumAmount}
                onChange={setPremiumAmount}
                placeholder="0"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Frequency</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={premiumFrequency}
                onChange={(e) => setPremiumFrequency(e.target.value)}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f.toLowerCase().replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Sum assured</span>
            <AmountInput value={sumAssured} onChange={setSumAssured} placeholder="0" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Next due</span>
              <DateInput
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Maturity / expiry</span>
              <DateInput
                value={maturityAt}
                onChange={(e) => setMaturityAt(e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Nominee</span>
            <Input
              value={nominee}
              onChange={(e) => setNominee(e.target.value)}
              maxLength={120}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Renew dialog ---------------- */

function RenewDialog({
  open,
  onClose,
  policyId,
  policy,
  memberCount,
}: {
  open: boolean;
  onClose: () => void;
  policyId: string;
  policy: Policy;
  memberCount: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"same" | "new">("same");
  const [nextDueDate, setNextDueDate] = useState("");
  const [premiumAmount, setPremiumAmount] = useState("");
  const [sumAssured, setSumAssured] = useState("");
  const [newPolicyNumber, setNewPolicyNumber] = useState("");
  const [newName, setNewName] = useState("");
  const [copyMembers, setCopyMembers] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- prefill from current policy on open */
    setMode("same");
    // Default next-due = one policy-frequency cycle from the current
    // next-due (or today if none set).
    const base = policy.nextDueDate ? new Date(policy.nextDueDate) : new Date();
    const months = policy.policyTermYears
      ? policy.policyTermYears * 12
      : freqMonths(policy.premiumFrequency);
    if (months) base.setMonth(base.getMonth() + months);
    setNextDueDate(base.toISOString().slice(0, 10));
    setPremiumAmount(policy.premiumAmount != null ? String(policy.premiumAmount) : "");
    setSumAssured(policy.sumAssured != null ? String(policy.sumAssured) : "");
    setNewPolicyNumber("");
    setNewName("");
    setCopyMembers(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, policy]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        mode,
        nextDueDate,
        premiumAmount: premiumAmount ? Number(premiumAmount) : null,
        sumAssured: sumAssured ? Number(sumAssured) : null,
      };
      if (mode === "new") {
        if (newPolicyNumber.trim()) payload.newPolicyNumber = newPolicyNumber.trim();
        if (newName.trim()) payload.newName = newName.trim();
        payload.copyMembers = copyMembers;
      }
      const res = await fetch(`/api/insurance/${policyId}/renew`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to renew");
        return;
      }
      globalMutate(`/api/investments/${policyId}`);
      globalMutate("/api/insurance");
      if (mode === "new" && body.id && body.id !== policyId) {
        router.push(`/insurance/${body.id}`);
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renew policy</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="text-xs font-medium">Renewal type</div>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "same"}
                  onChange={() => setMode("same")}
                />
                <span>Same policy number</span>
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
                <span>Issued new policy number</span>
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {mode === "same"
                ? "Updates the existing policy in place — next due date bumps forward, premium/sum assured optionally update."
                : "Creates a new policy row linked back to this one. Old policy is marked Renewed and excluded from active counts."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Next due (after renewal)</span>
              <DateInput
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Premium per cycle</span>
              <AmountInput
                value={premiumAmount}
                onChange={setPremiumAmount}
                placeholder="0"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Sum assured</span>
            <AmountInput value={sumAssured} onChange={setSumAssured} placeholder="0" />
          </label>
          {mode === "new" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">New policy #</span>
                  <Input
                    value={newPolicyNumber}
                    onChange={(e) => setNewPolicyNumber(e.target.value)}
                    placeholder={policy.policyNumber ?? "OPT/2026/123"}
                    maxLength={80}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium">New name (optional)</span>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={policy.name}
                    maxLength={120}
                  />
                </label>
              </div>
              {memberCount > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={copyMembers}
                    onChange={(e) => setCopyMembers(e.target.checked)}
                  />
                  <span>
                    Copy {memberCount} covered member{memberCount === 1 ? "" : "s"}{" "}
                    to the new policy
                  </span>
                </label>
              )}
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              submitting ||
              !nextDueDate ||
              (mode === "new" && !newPolicyNumber.trim() && !newName.trim())
            }
          >
            {mode === "same" ? "Update next due" : "Create renewed policy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function freqMonths(f: string | null): number {
  switch (f) {
    case "MONTHLY":
      return 1;
    case "QUARTERLY":
      return 3;
    case "HALF_YEARLY":
      return 6;
    case "YEARLY":
      return 12;
    default:
      return 12;
  }
}
