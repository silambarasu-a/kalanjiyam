"use client";

import { useState } from "react";
import useSWR from "swr";
import { Stethoscope, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavigatingCard } from "@/components/ui/navigating-card";
import { MedicalRecordDialog } from "@/components/medical/record-dialog";
import { formatDate } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type PatientSummary = {
  contact: { id: string; name: string; relationship: string | null };
  checkupCount: number;
  hospitalizationCount: number;
  lastOccurredAt: string;
  lastFacilityName: string;
  ongoingHospitalization: boolean;
  openClaimCount: number;
};

export default function MedicalPage() {
  const { data, isLoading } = useSWR<{ patients: PatientSummary[] }>(
    "/api/medical-records/patients",
    fetcher,
  );
  const [open, setOpen] = useState(false);
  const patients = data?.patients ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Medical Records</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Health history per person — checkups, hospitalizations, and their
            bills. Open a person to see their full history.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New record
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && patients.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No medical records yet. Add a checkup or hospitalization to start a
          person&apos;s history.
        </p>
      )}

      {patients.length > 0 && (
        <div className="rounded-lg border bg-card divide-y">
          {patients.map((p) => (
            <PatientRow key={p.contact.id} p={p} />
          ))}
        </div>
      )}

      <MedicalRecordDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function PatientRow({ p }: { p: PatientSummary }) {
  const counts = [
    p.checkupCount > 0
      ? `${p.checkupCount} checkup${p.checkupCount === 1 ? "" : "s"}`
      : null,
    p.hospitalizationCount > 0
      ? `${p.hospitalizationCount} hospitalization${
          p.hospitalizationCount === 1 ? "" : "s"
        }`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <NavigatingCard
      href={`/medical/${p.contact.id}`}
      className="flex items-start justify-between gap-3 p-4 hover:bg-muted/40"
      ariaLabel={`Open medical history of ${p.contact.name}`}
    >
      <div className="flex items-start gap-3">
        <Stethoscope className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{p.contact.name}</span>
            {p.contact.relationship && (
              <span className="text-xs text-muted-foreground">
                {p.contact.relationship}
              </span>
            )}
            {p.ongoingHospitalization && (
              <span className="rounded-full border border-destructive/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-destructive">
                in hospital
              </span>
            )}
            {p.openClaimCount > 0 && (
              <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {p.openClaimCount} open claim{p.openClaimCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {counts}
            {` · Last visit ${formatDate(p.lastOccurredAt)} at ${p.lastFacilityName}`}
          </div>
        </div>
      </div>
    </NavigatingCard>
  );
}
