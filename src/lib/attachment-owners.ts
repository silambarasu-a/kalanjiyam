import { prisma } from "@/lib/prisma";
import type { AttachmentOwnerKind } from "@/lib/attachments";

/**
 * Polymorphic owner resolver: looks up the parent row for an
 * `(ownerKind, ownerId)` pair, then enforces workspace isolation.
 *
 * Returns true only when the parent row exists AND belongs to the
 * caller's workspace. Returns false on any other case so the route can
 * 404 the caller — never leak existence of cross-workspace rows.
 *
 * Add a new owner kind by extending this switch + ATTACHMENT_POLICY in
 * src/lib/attachments.ts.
 */
export async function assertOwnerInWorkspace(
  ownerKind: AttachmentOwnerKind,
  ownerId: string,
  workspaceId: string,
): Promise<boolean> {
  switch (ownerKind) {
    case "VEHICLE_DOCUMENT": {
      const row = await prisma.vehicleDocument.findUnique({
        where: { id: ownerId },
        select: { workspaceId: true },
      });
      return !!row && row.workspaceId === workspaceId;
    }
    case "INSURANCE_POLICY": {
      const row = await prisma.investment.findUnique({
        where: { id: ownerId },
        select: { workspaceId: true, kind: true },
      });
      return !!row && row.workspaceId === workspaceId && row.kind === "INSURANCE";
    }
    case "CARD_STATEMENT": {
      const row = await prisma.cardStatement.findUnique({
        where: { id: ownerId },
        select: { workspaceId: true },
      });
      return !!row && row.workspaceId === workspaceId;
    }
    case "TRANSACTION_RECEIPT": {
      const row = await prisma.transaction.findUnique({
        where: { id: ownerId },
        select: { workspaceId: true },
      });
      return !!row && row.workspaceId === workspaceId;
    }
    case "CROP_BATCH_BILL": {
      const row = await prisma.crop.findUnique({
        where: { id: ownerId },
        select: { workspaceId: true },
      });
      return !!row && row.workspaceId === workspaceId;
    }
    case "LOAN_DOCUMENT": {
      const row = await prisma.loan.findUnique({
        where: { id: ownerId },
        select: { workspaceId: true },
      });
      return !!row && row.workspaceId === workspaceId;
    }
    case "INCOME_PROOF": {
      // Income proofs attach to a Contact (the earner). Re-purpose if a
      // dedicated IncomeProof model arrives.
      const row = await prisma.contact.findUnique({
        where: { id: ownerId },
        select: { workspaceId: true },
      });
      return !!row && row.workspaceId === workspaceId;
    }
    default: {
      const exhaustive: never = ownerKind;
      void exhaustive;
      return false;
    }
  }
}
