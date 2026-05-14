"use client";

import { NavigatingCard } from "@/components/ui/navigating-card";
import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Plus, ShieldCheck, Users, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { InsurerPicker } from "@/components/ui/insurer-picker";
import {
  EMPTY_INSURANCE_EXTRAS,
  buildInsuranceExtraPayload,
  incompleteMemberRows,
  InsurancePolicyExtrasFields,
  submitPolicyMembers,
  type InsurancePolicyExtras,
} from "@/components/insurance/policy-extras-fields";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatINR, formatDate } from "@/lib/utils";

type PolicyType =
  | "LIFE"
  | "HEALTH"
  | "VEHICLE"
  | "HOME"
  | "TRAVEL"
  | "TERM"
  | "ULIP"
  | "ENDOWMENT"
  | "OTHER";

type Policy = {
  id: string;
  name: string;
  institution: string | null;
  policyNumber: string | null;
  policyType: PolicyType | null;
  insuranceStatus: string | null;
  premiumAmount: number | null;
  premiumFrequency: string | null;
  sumAssured: number | null;
  nextDueDate: string | null;
  nominee: string | null;
  active: boolean;
  memberCount: number;
  members: { id: string; contactName: string; premiumAmount: number | null }[];
  claimCount: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const TABS: { value: "ALL" | PolicyType; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "HEALTH", label: "Health" },
  { value: "LIFE", label: "Life" },
  { value: "VEHICLE", label: "Vehicle" },
  { value: "OTHER", label: "Other" },
];

const OTHER_TYPES: PolicyType[] = ["HOME", "TRAVEL", "TERM", "ULIP", "ENDOWMENT", "OTHER"];

export default function InsurancePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("ALL");
  const [newOpen, setNewOpen] = useState(false);
  const { data, isLoading } = useSWR<{ policies: Policy[] }>("/api/insurance", fetcher);

  const policies = useMemo(() => {
    const all = data?.policies ?? [];
    if (tab === "ALL") return all;
    if (tab === "OTHER") {
      return all.filter((p) => p.policyType && OTHER_TYPES.includes(p.policyType));
    }
    return all.filter((p) => p.policyType === tab);
  }, [data, tab]);

  const today = new Date();
  const overdue = policies.filter(
    (p) => p.nextDueDate && new Date(p.nextDueDate) < today,
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Insurance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track policies, the people they cover, premium due dates, and claims.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New policy
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Active policies"
          value={String(policies.filter((p) => p.active).length)}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <StatCard
          label="Covered members"
          value={String(
            policies.reduce((s, p) => s + p.memberCount, 0),
          )}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Overdue premiums"
          value={String(overdue)}
          icon={<AlertTriangle className="h-4 w-4" />}
          highlight={overdue > 0}
        />
      </div>

      <div className="flex gap-2 border-b">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              tab === t.value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && policies.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No {tab === "ALL" ? "" : tab.toLowerCase() + " "}policies yet.
        </p>
      )}

      <div className="rounded-lg border bg-card divide-y">
        {policies.map((p) => (
          <PolicyRow key={p.id} policy={p} />
        ))}
      </div>

      <NewPolicyDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-4 ${
        highlight ? "border-amber-300 bg-amber-50/40 dark:bg-amber-950/20" : ""
      }`}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function PolicyRow({ policy }: { policy: Policy }) {
  const isOverdue =
    policy.nextDueDate && new Date(policy.nextDueDate) < new Date();
  return (
    <NavigatingCard
      href={`/insurance/${policy.id}`}
      className="flex items-start justify-between gap-3 p-4 hover:bg-muted/40"
      ariaLabel={`Open ${policy.name}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{policy.name}</span>
          {policy.policyType && (
            <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {policy.policyType}
            </span>
          )}
          {!policy.active && (
            <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              Inactive
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {policy.institution ?? "—"}
          {policy.policyNumber ? ` · ${policy.policyNumber}` : ""}
        </div>
        {policy.memberCount > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            Covers: {policy.members.map((m) => m.contactName).join(", ")}
          </div>
        )}
      </div>
      <div className="text-right text-sm shrink-0">
        {policy.premiumAmount != null && (
          <div className="font-medium">
            {formatINR(policy.premiumAmount)}
            <span className="text-xs text-muted-foreground">
              {policy.premiumFrequency ? ` · ${policy.premiumFrequency.toLowerCase()}` : ""}
            </span>
          </div>
        )}
        {policy.nextDueDate && (
          <div
            className={`mt-0.5 text-xs ${
              isOverdue ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
            }`}
          >
            Due {formatDate(policy.nextDueDate)}
          </div>
        )}
        {policy.claimCount > 0 && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {policy.claimCount} claim{policy.claimCount === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </NavigatingCard>
  );
}

/* ---------------- New policy dialog ---------------- */

const POLICY_TYPES: { value: PolicyType; label: string }[] = [
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

const FREQUENCIES = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "ONE_TIME"];

function NewPolicyDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [policyType, setPolicyType] = useState<PolicyType>("HEALTH");
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [premiumAmount, setPremiumAmount] = useState("");
  const [premiumFrequency, setPremiumFrequency] = useState("YEARLY");
  const [sumAssured, setSumAssured] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [nextDueDate, setNextDueDate] = useState("");
  const [maturityAt, setMaturityAt] = useState("");
  const [nominee, setNominee] = useState("");
  const [notes, setNotes] = useState("");
  const [extras, setExtras] = useState<InsurancePolicyExtras>(EMPTY_INSURANCE_EXTRAS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: contactsData } = useSWR<{ members: { id: string; name: string }[] }>(
    open ? "/api/contacts" : null,
    fetcher,
  );
  const contacts = contactsData?.members ?? [];

  const { data: vehiclesData } = useSWR<{
    vehicles: { id: string; name: string; kind: string; registrationNo: string | null }[];
  }>(open && policyType === "VEHICLE" ? "/api/vehicles" : null, fetcher);
  const vehicles = vehiclesData?.vehicles ?? [];

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form on dialog open */
    setPolicyType("HEALTH");
    setName("");
    setInstitution("");
    setPolicyNumber("");
    setPremiumAmount("");
    setPremiumFrequency("YEARLY");
    setSumAssured("");
    setStartedAt(new Date().toISOString().slice(0, 10));
    setNextDueDate("");
    setMaturityAt("");
    setNominee("");
    setNotes("");
    setExtras(EMPTY_INSURANCE_EXTRAS);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  const insurerCategoryFilter = (() => {
    if (policyType === "LIFE" || policyType === "TERM" || policyType === "ULIP" || policyType === "ENDOWMENT")
      return ["Life" as const];
    if (policyType === "HEALTH") return ["Health" as const];
    if (policyType === "VEHICLE" || policyType === "HOME" || policyType === "TRAVEL")
      return ["General" as const];
    return undefined;
  })();

  // Any partially-filled member row is a red flag — better to bail
  // early than save the policy + silently drop those rows.
  const incompleteMembers = incompleteMemberRows(extras.members);

  async function submit() {
    setError(null);
    if (incompleteMembers.length > 0) {
      const rows = incompleteMembers.map(({ idx }) => `#${idx + 1}`).join(", ");
      setError(
        `Member ${rows} ${incompleteMembers.length === 1 ? "is" : "are"} missing required fields — pick a contact${extras.members.some((m) => m.role === "BENEFICIARY" && !m.sharePercent) ? " and share %" : ""}, or remove the row.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        kind: "INSURANCE",
        name: name.trim(),
        institution: institution.trim() || undefined,
        policyType,
        policyNumber: policyNumber.trim() || undefined,
        amount: premiumAmount ? Number(premiumAmount) : 0,
        premiumAmount: premiumAmount ? Number(premiumAmount) : undefined,
        premiumFrequency: premiumFrequency || undefined,
        sumAssured: sumAssured ? Number(sumAssured) : undefined,
        startedAt: startedAt || new Date().toISOString().slice(0, 10),
        nextDueDate: nextDueDate || undefined,
        maturityAt: maturityAt || undefined,
        nominee: nominee.trim() || undefined,
        notes: notes.trim() || undefined,
        // Vehicle picker, life corporate fields, vehicle coverage —
        // shared with the transaction-dialog INSURANCE branch.
        ...buildInsuranceExtraPayload(extras, policyType),
        // No transaction is created — this records an existing policy.
        isExisting: true,
      };
      const res = await fetch("/api/investments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed");
        return;
      }
      const policyId = body.id as string;

      // Add covered members / beneficiaries. Each call is independent —
      // partial success surfaces an error and leaves the policy in
      // place so the user can finish on the detail page.
      const memberErrors = await submitPolicyMembers(
        policyId,
        extras.members,
        premiumFrequency,
      );

      globalMutate("/api/insurance");
      if (memberErrors.length > 0) {
        setError(
          `Policy created, but some members failed: ${memberErrors.join("; ")}. Finish adding them on the policy page.`,
        );
      } else {
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
          <DialogTitle>New policy</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Adding an existing policy you&apos;re already paying for. No transaction is
            created — record this premium payment separately when it&apos;s actually paid.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Type</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={policyType}
                onChange={(e) => setPolicyType(e.target.value as PolicyType)}
              >
                {POLICY_TYPES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium">Policy # (optional)</span>
              <Input
                value={policyNumber}
                onChange={(e) => setPolicyNumber(e.target.value)}
                maxLength={80}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Insurer</span>
            <InsurerPicker
              value={institution}
              onChange={setInstitution}
              filterCategories={insurerCategoryFilter}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Plan name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Optima Restore Family"
              maxLength={120}
              autoFocus
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">
                Premium <span className="font-normal text-muted-foreground">per cycle</span>
              </span>
              <AmountInput value={premiumAmount} onChange={setPremiumAmount} placeholder="0" />
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
            <span className="text-xs font-medium">
              Sum assured <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <AmountInput value={sumAssured} onChange={setSumAssured} placeholder="0" />
          </label>

          <InsurancePolicyExtrasFields
            policyType={policyType}
            premiumFrequency={premiumFrequency}
            value={extras}
            onChange={setExtras}
            contacts={contacts}
            vehicles={vehicles}
          />

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Started</span>
              <DateInput value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Next due</span>
              <DateInput value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Maturity / expiry</span>
              <DateInput value={maturityAt} onChange={(e) => setMaturityAt(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Nominee (optional)</span>
            <Input value={nominee} onChange={(e) => setNominee(e.target.value)} maxLength={120} />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={
              submitting ||
              !name.trim() ||
              !premiumAmount ||
              Number(premiumAmount) <= 0 ||
              incompleteMembers.length > 0
            }
          >
            Add policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
