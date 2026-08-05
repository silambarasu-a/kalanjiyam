"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Plus, Stethoscope, BedDouble } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavigatingCard } from "@/components/ui/navigating-card";
import { MedicalRecordDialog, KIND_LABEL } from "@/components/medical/record-dialog";
import type { MedicalRecordKind } from "@/components/medical/record-dialog";
import { formatDate } from "@/lib/utils";
import { fetcher } from "@/lib/swr-fetcher";

type MedicalRecordRow = {
  id: string;
  kind: MedicalRecordKind;
  facilityName: string;
  diagnosis: string | null;
  occurredAt: string;
  dischargedAt: string | null;
  patientContact: { id: string; name: string; relationship: string | null };
  claim: { id: string; claimNumber: string | null; status: string } | null;
  transactionCount: number;
};

export default function MedicalPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data, isLoading } = useSWR<{ records: MedicalRecordRow[] }>(
    `/api/medical-records?patientContactId=${id}`,
    fetcher,
  );
  const { data: contactsData, error: contactsError } = useSWR<{
    members: { id: string; name: string; relationship: string | null }[];
  }>("/api/contacts", fetcher);
  const [open, setOpen] = useState(false);

  const records = data?.records ?? [];
  const contact =
    contactsData?.members.find((m) => m.id === id) ??
    records[0]?.patientContact ??
    null;

  // Legacy deep links: /medical/<id> used to be a hospitalization id. When
  // the id has no records and doesn't resolve to a contact (including when
  // this member cannot read contacts at all), probe the record endpoint and
  // forward old bookmarks to /medical/records/<id>. Goes through the shared
  // fetcher so the idle-lock (423) contract and SWR revalidation apply.
  const idIsUnknown =
    !isLoading &&
    records.length === 0 &&
    (contactsData
      ? !contactsData.members.some((m) => m.id === id)
      : !!contactsError);
  const { data: probe, error: probeError } = useSWR<{ record: { id: string } }>(
    idIsUnknown ? `/api/medical-records/${id}` : null,
    fetcher,
  );
  useEffect(() => {
    if (probe) router.replace(`/medical/records/${id}`);
  }, [probe, id, router]);

  const checkups = records.filter((r) => r.kind === "CHECKUP").length;
  const hospitalizations = records.length - checkups;

  // Covers initial load, waiting on contact resolution, probing a legacy
  // id, and the redirect itself — avoids flashing a phantom person page.
  const resolving =
    isLoading ||
    (records.length === 0 && !contactsData && !contactsError) ||
    (idIsUnknown && !probeError);
  if (resolving) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (idIsUnknown) {
    return (
      <p className="text-sm text-muted-foreground">
        Person not found.{" "}
        <Link href="/medical" className="underline">
          Back to medical records
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/medical"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> All people
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {contact?.name ?? "…"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {contact?.relationship ? `${contact.relationship} · ` : ""}
            {records.length === 0
              ? "No medical records yet"
              : [
                  checkups > 0 ? `${checkups} checkup${checkups === 1 ? "" : "s"}` : null,
                  hospitalizations > 0
                    ? `${hospitalizations} hospitalization${
                        hospitalizations === 1 ? "" : "s"
                      }`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New record
        </Button>
      </div>

      {records.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Record a checkup (fever, cold, consultation) or a hospitalization for{" "}
          {contact?.name ?? "this person"}.
        </p>
      )}

      {records.length > 0 && (
        <div className="rounded-lg border bg-card divide-y">
          {records.map((r) => (
            <RecordRow key={r.id} r={r} />
          ))}
        </div>
      )}

      <MedicalRecordDialog
        open={open}
        onClose={() => setOpen(false)}
        patientContactId={id}
      />
    </div>
  );
}

function RecordRow({ r }: { r: MedicalRecordRow }) {
  const isHospitalization = r.kind === "HOSPITALIZATION";
  const Icon = isHospitalization ? BedDouble : Stethoscope;
  return (
    <NavigatingCard
      href={`/medical/records/${r.id}`}
      className="flex items-start justify-between gap-3 p-4 hover:bg-muted/40"
      ariaLabel={`Open ${KIND_LABEL[r.kind].toLowerCase()} at ${r.facilityName}`}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{r.facilityName}</span>
            <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {KIND_LABEL[r.kind]}
            </span>
            {r.claim && (
              <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                claim · {r.claim.status.replace("_", " ").toLowerCase()}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {isHospitalization
              ? `Admitted ${formatDate(r.occurredAt)}${
                  r.dischargedAt
                    ? ` · Discharged ${formatDate(r.dischargedAt)}`
                    : " · Ongoing"
                }`
              : `Visited ${formatDate(r.occurredAt)}`}
            {r.diagnosis ? ` · ${r.diagnosis}` : ""}
          </div>
        </div>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        {r.transactionCount > 0 && (
          <div>
            {r.transactionCount} bill{r.transactionCount === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </NavigatingCard>
  );
}
