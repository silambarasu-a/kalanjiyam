"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetcher } from "@/lib/swr-fetcher";

export type MedicalRecordKind = "CHECKUP" | "HOSPITALIZATION";

export const KIND_LABEL: Record<MedicalRecordKind, string> = {
  CHECKUP: "Checkup",
  HOSPITALIZATION: "Hospitalization",
};

/**
 * Create-record dialog shared by the Medical pages. When
 * `patientContactId` is given (person history page) the patient is
 * fixed; otherwise the user picks one from Contacts.
 */
export function MedicalRecordDialog({
  open,
  onClose,
  patientContactId,
}: {
  open: boolean;
  onClose: () => void;
  patientContactId?: string;
}) {
  const { data: contactsData } = useSWR<{ members: { id: string; name: string }[] }>(
    open && !patientContactId ? "/api/contacts" : null,
    fetcher,
  );
  const contacts = contactsData?.members ?? [];

  const [kind, setKind] = useState<MedicalRecordKind>("CHECKUP");
  const [patientId, setPatientId] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [dischargedAt, setDischargedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset form on dialog open */
    setKind("CHECKUP");
    setPatientId(patientContactId ?? "");
    setFacilityName("");
    setDiagnosis("");
    setOccurredAt(new Date().toISOString().slice(0, 10));
    setDischargedAt("");
    setNotes("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, patientContactId]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/medical-records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientContactId: patientId,
          kind,
          facilityName: facilityName.trim(),
          diagnosis: diagnosis.trim() || undefined,
          occurredAt,
          dischargedAt: kind === "HOSPITALIZATION" && dischargedAt ? dischargedAt : undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Failed");
      else {
        // Refresh every medical-records key (person lists, patient
        // histories, record details) in one filter mutate.
        globalMutate(
          (key) => typeof key === "string" && key.startsWith("/api/medical-records"),
        );
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const isHospitalization = kind === "HOSPITALIZATION";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New medical record</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(KIND_LABEL) as MedicalRecordKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-md border px-3 py-2 text-sm ${
                  kind === k
                    ? "border-foreground/60 bg-muted/60 font-medium"
                    : "text-muted-foreground hover:bg-muted/40"
                }`}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          {!patientContactId && (
            <label className="block">
              <span className="text-xs font-medium">Patient</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
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
          )}
          <label className="block">
            <span className="text-xs font-medium">
              {isHospitalization ? "Hospital" : "Clinic / hospital"}
            </span>
            <Input
              value={facilityName}
              onChange={(e) => setFacilityName(e.target.value)}
              placeholder={
                isHospitalization
                  ? "e.g. Apollo Hospitals, Chennai"
                  : "e.g. Dr. Kumar Clinic"
              }
              maxLength={120}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">
              Reason / diagnosis{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <Input
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder={isHospitalization ? "" : "e.g. Fever, cold"}
              maxLength={200}
            />
          </label>
          {isHospitalization ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium">Admitted</span>
                <DateInput
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
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
          ) : (
            <label className="block">
              <span className="text-xs font-medium">Visit date</span>
              <DateInput
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </label>
          )}
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
            disabled={submitting || !patientId || !facilityName.trim() || !occurredAt}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
