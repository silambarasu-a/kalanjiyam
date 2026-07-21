import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[medical-records/patients]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

type PatientSummary = {
  contact: { id: string; name: string; relationship: string | null };
  checkupCount: number;
  hospitalizationCount: number;
  /**
   * Most recent record (visit or admission) for the person.
   */
  lastOccurredAt: string;
  lastFacilityName: string;
  /**
   * True while a hospitalization has no discharge date yet.
   */
  ongoingHospitalization: boolean;
  openClaimCount: number;
};

const SETTLED_CLAIM_STATUSES = new Set(["PAID", "CLOSED", "REJECTED"]);

export async function GET() {
  try {
    const ctx = await requireWorkspace("medical", "read");
    const rows = await prisma.medicalRecord.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { occurredAt: "desc" },
      include: {
        patientContact: { select: { id: true, name: true, relationship: true } },
        claim: { select: { status: true } },
      },
    });

    const byPatient = new Map<string, PatientSummary>();
    for (const r of rows) {
      let s = byPatient.get(r.patientContactId);
      if (!s) {
        // Rows are ordered newest-first, so the first row seen per
        // patient carries their latest visit.
        s = {
          contact: r.patientContact,
          checkupCount: 0,
          hospitalizationCount: 0,
          lastOccurredAt: r.occurredAt.toISOString(),
          lastFacilityName: r.facilityName,
          ongoingHospitalization: false,
          openClaimCount: 0,
        };
        byPatient.set(r.patientContactId, s);
      }
      if (r.kind === "CHECKUP") s.checkupCount += 1;
      else {
        s.hospitalizationCount += 1;
        if (!r.dischargedAt) s.ongoingHospitalization = true;
      }
      if (r.claim && !SETTLED_CLAIM_STATUSES.has(r.claim.status)) {
        s.openClaimCount += 1;
      }
    }

    return NextResponse.json({
      patients: [...byPatient.values()].sort((a, b) =>
        a.contact.name.localeCompare(b.contact.name),
      ),
    });
  } catch (e) {
    return err(e);
  }
}
