"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Stethoscope, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavigatingCard } from "@/components/ui/navigating-card";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";

type Hospitalization = {
  id: string;
  hospitalName: string;
  diagnosis: string | null;
  admittedAt: string;
  dischargedAt: string | null;
  notes: string | null;
  patientContact: { id: string; name: string };
  claim: { id: string; claimNumber: string | null; status: string } | null;
  transactionCount: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function MedicalPage() {
  const { data, isLoading } = useSWR<{ hospitalizations: Hospitalization[] }>(
    "/api/hospitalizations",
    fetcher,
  );
  const [open, setOpen] = useState(false);
  const rows = data?.hospitalizations ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Medical Records</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each row is one hospitalization episode. Tag Hospital expenses in the
            transaction dialog to a patient + episode + stage (pre / during / post),
            and they roll up here.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New episode
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No hospitalizations recorded.</p>
      )}

      <div className="rounded-lg border bg-card divide-y">
        {rows.map((h) => (
          <Row key={h.id} h={h} />
        ))}
      </div>

      <HospitalizationDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function Row({ h }: { h: Hospitalization }) {
  return (
    <NavigatingCard
      href={`/medical/${h.id}`}
      className="flex items-start justify-between gap-3 p-4 hover:bg-muted/40"
      ariaLabel={`Open hospitalization at ${h.hospitalName}`}
    >
      <div className="flex items-start gap-3">
        <Stethoscope className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{h.patientContact.name}</span>
            <span className="text-xs text-muted-foreground">
              at {h.hospitalName}
            </span>
            {h.claim && (
              <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                claim · {h.claim.status.replace("_", " ").toLowerCase()}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Admitted {formatDate(h.admittedAt)}
            {h.dischargedAt ? ` · Discharged ${formatDate(h.dischargedAt)}` : " · Ongoing"}
            {h.diagnosis ? ` · ${h.diagnosis}` : ""}
          </div>
        </div>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        {h.transactionCount > 0 && (
          <div>
            {h.transactionCount} bill{h.transactionCount === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </NavigatingCard>
  );
}

function HospitalizationDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: contactsData } = useSWR<{ members: { id: string; name: string }[] }>(
    open ? "/api/contacts" : null,
    fetcher,
  );
  const contacts = contactsData?.members ?? [];

  const [patientContactId, setPatientContactId] = useState("");
  const [hospitalName, setHospitalName] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [admittedAt, setAdmittedAt] = useState("");
  const [dischargedAt, setDischargedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form on dialog open */
    setPatientContactId("");
    setHospitalName("");
    setDiagnosis("");
    setAdmittedAt(new Date().toISOString().slice(0, 10));
    setDischargedAt("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/hospitalizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientContactId,
          hospitalName: hospitalName.trim(),
          diagnosis: diagnosis.trim() || undefined,
          admittedAt,
          dischargedAt: dischargedAt || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        globalMutate("/api/hospitalizations");
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
          <DialogTitle>New hospitalization</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium">Patient</span>
            <select
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={patientContactId}
              onChange={(e) => setPatientContactId(e.target.value)}
            >
              <option value="">Select contact…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {contacts.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                No contacts yet.{" "}
                <Link href="/contacts" className="underline">
                  Add the patient on Contacts
                </Link>
                , then come back.
              </p>
            )}
          </label>
          <label className="block">
            <span className="text-xs font-medium">Hospital</span>
            <Input
              value={hospitalName}
              onChange={(e) => setHospitalName(e.target.value)}
              placeholder="e.g. Apollo Hospitals, Chennai"
              maxLength={120}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Diagnosis (optional)</span>
            <Input
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              maxLength={200}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Admitted</span>
              <DateInput
                value={admittedAt}
                onChange={(e) => setAdmittedAt(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Discharged</span>
              <DateInput
                value={dischargedAt}
                onChange={(e) => setDischargedAt(e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              submitting || !patientContactId || !hospitalName.trim() || !admittedAt
            }
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
