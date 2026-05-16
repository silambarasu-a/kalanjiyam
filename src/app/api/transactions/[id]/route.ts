import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canModifyRecord } from "@/lib/permissions";
import { transactionUpdateSchema } from "@/lib/validators-domain";
import {
  MemberChargeType,
  MemberChargeStatus,
  ReminderStatus,
} from "@/generated/prisma/client";
import {
  reverseLoanPaymentPrincipal,
  splitPayment,
  type LoanFrequency,
} from "@/lib/loan-math";
import { checkTransactionEditAllowed } from "@/lib/transaction-edit-lock";
import { archiveAttachmentsForOwner } from "@/lib/attachment-archive";
import { isS3Configured, presignGet } from "@/lib/s3";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadOwnership(transactionId: string) {
  const t = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      account: { select: { ownerUserId: true, sharedWithUserIds: true } },
      card: { select: { ownerUserId: true, sharedWithUserIds: true } },
    },
  });
  if (!t) return null;
  return {
    transaction: t,
    ownership: {
      ownerUserId: t.account?.ownerUserId ?? t.card?.ownerUserId ?? t.userId,
      sharedWithUserIds:
        t.account?.sharedWithUserIds ?? t.card?.sharedWithUserIds ?? [],
    },
  };
}

/**
 * GET /api/transactions/[id] — detail view for a single transaction.
 *
 * Returns the transaction's core fields plus all linked context
 * (category w/ parent, account, card, beneficiary, vehicle, event,
 * hospitalization, fuel data, transfer legs, member-charge state) and
 * a list of active receipt attachments with short-lived presigned GET
 * URLs so the UI can render inline image / PDF previews without a
 * second round trip.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("transactions", "read");
    const { id } = await context.params;
    const t = await prisma.transaction.findUnique({
      where: { id },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            parent: { select: { id: true, name: true } },
          },
        },
        account: { select: { id: true, name: true, kind: true } },
        card: { select: { id: true, name: true } },
        beneficiaryContact: { select: { id: true, name: true } },
        splits: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            amount: true,
            sharePercent: true,
            isRecoverable: true,
            notes: true,
            contact: { select: { id: true, name: true } },
            memberCharge: {
              select: { id: true, status: true, amount: true, settledAmount: true },
            },
          },
        },
        vehicle: { select: { id: true, name: true, registrationNo: true } },
        event: { select: { id: true, name: true, kind: true } },
        hospitalization: {
          select: {
            id: true,
            hospitalName: true,
            patientContact: { select: { id: true, name: true } },
          },
        },
        transfer: {
          select: {
            fromAccount: { select: { id: true, name: true, kind: true } },
            toAccount: { select: { id: true, name: true, kind: true } },
            fromContact: { select: { id: true, name: true } },
            toContact: { select: { id: true, name: true } },
          },
        },
        user: { select: { id: true, name: true } },
      },
    });
    if (!t || t.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Active attachments + presigned URLs for inline preview / download.
    const attachmentRows = await prisma.attachment.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ownerKind: "TRANSACTION_RECEIPT",
        ownerId: t.id,
        archivedAt: null,
      },
      orderBy: { uploadedAt: "desc" },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    });
    const canSign = isS3Configured();
    const attachments = await Promise.all(
      attachmentRows.map(async (a) => {
        let url: string | null = null;
        if (canSign) {
          try {
            url = await presignGet(a.s3Key, 300);
          } catch {
            url = null;
          }
        }
        return {
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          uploadedAt: a.uploadedAt.toISOString(),
          uploadedBy: a.uploadedBy
            ? { id: a.uploadedBy.id, name: a.uploadedBy.name }
            : null,
          url,
        };
      }),
    );

    return NextResponse.json({
      transaction: {
        id: t.id,
        type: t.type,
        kind: t.kind,
        amount: Number(t.amount),
        description: t.description,
        date: t.date.toISOString(),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        editedAt: t.editedAt?.toISOString() ?? null,
        editNote: t.editNote,
        category: t.category
          ? {
              id: t.category.id,
              name: t.category.name,
              parent: t.category.parent,
            }
          : null,
        account: t.account,
        card: t.card,
        beneficiary: t.beneficiaryContact,
        memberChargeType: t.memberChargeType,
        splits: t.splits.map((s) => ({
          id: s.id,
          contact: s.contact,
          amount: Number(s.amount),
          sharePercent: s.sharePercent == null ? null : Number(s.sharePercent),
          isRecoverable: s.isRecoverable,
          notes: s.notes,
          charge: s.memberCharge
            ? {
                id: s.memberCharge.id,
                status: s.memberCharge.status,
                amount: Number(s.memberCharge.amount),
                settledAmount: Number(s.memberCharge.settledAmount),
              }
            : null,
        })),
        vehicle: t.vehicle,
        event: t.event,
        hospitalization: t.hospitalization,
        hospitalizationStage: t.hospitalizationStage,
        transferId: t.transferId,
        transfer: t.transfer,
        eventId: t.eventId,
        vehicleId: t.vehicleId,
        fuelQuantity: t.fuelQuantity == null ? null : Number(t.fuelQuantity),
        fuelUnit: t.fuelUnit,
        fuelOdometer: t.fuelOdometer,
        author: t.user,
      },
      attachments,
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("transactions", "write");
    const session = await auth();
    const { id } = await context.params;
    const loaded = await loadOwnership(id);
    if (!loaded || loaded.transaction.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, loaded.ownership)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
const body = await request.json();
    const parsed = transactionUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const t = loaded.transaction;

    // Edit-window check (closed-loan, statement-closed, then N-day window).
    // OWNER/ADMIN can pass `force: true` to bypass.
    const lock = await checkTransactionEditAllowed({
      transaction: {
        id: t.id,
        date: t.date,
        accountId: t.accountId,
        workspaceId: t.workspaceId,
        loanId: t.loanId,
        type: t.type,
        kind: t.kind,
      },
      role: ctx.role,
      force: body?.force === true,
    });
    if (!lock.ok) {
      return NextResponse.json(
        { error: lock.message, canForce: lock.canForce },
        { status: lock.status },
      );
    }

    // Transfer legs are immutable — they're book-kept by the Transfer
    // record itself. Editing one leg in isolation would desync the pair.
    if (t.transferId) {
      return NextResponse.json(
        { error: "Edit the transfer instead, not its leg." },
        { status: 400 },
      );
    }
    // Loan disbursements were created together with the loan; let the
    // user adjust them through the loan record, not here.
    if (t.loanId && t.type === "INCOME" && t.kind === "LOAN_PAYMENT") {
      return NextResponse.json(
        { error: "Edit the loan to change its disbursement." },
        { status: 400 },
      );
    }

    const oldAmount = Number(t.amount);
    const newAmount =
      parsed.data.amount != null ? Number(parsed.data.amount) : oldAmount;
    const amountChanged = newAmount !== oldAmount;

    // Pull every relation that needs rebalancing in one round-trip.
    const full = amountChanged
      ? await prisma.transaction.findUniqueOrThrow({
          where: { id },
          include: {
            loan: true,
            investment: true,
            wagePayment: true,
            livestockEvent: true,
            feedLog: true,
            vaccinationLog: true,
          },
        })
      : null;

    // Splits handling (Slice 2). When `splits` is omitted, leave existing
    // rows alone. When provided, the new set diff-replaces what's in DB.
    const splitsInput = parsed.data.splits;
    type ExistingSplit = {
      id: string;
      contactId: string;
      amount: number;
      isRecoverable: boolean;
      memberChargeId: string | null;
      chargeSettled: number;
      chargeSettlementCount: number;
    };
    let existingSplits: ExistingSplit[] = [];
    if (splitsInput !== undefined) {
      if (t.type !== "EXPENSE") {
        return NextResponse.json(
          { error: "Splits are only allowed on expenses" },
          { status: 400 },
        );
      }
      const rows = await prisma.transactionSplit.findMany({
        where: { transactionId: id },
        include: {
          memberCharge: {
            select: { id: true, settledAmount: true, _count: { select: { settlements: true } } },
          },
        },
      });
      existingSplits = rows.map((r) => ({
        id: r.id,
        contactId: r.contactId,
        amount: Number(r.amount),
        isRecoverable: r.isRecoverable,
        memberChargeId: r.memberChargeId,
        chargeSettled: r.memberCharge ? Number(r.memberCharge.settledAmount) : 0,
        chargeSettlementCount: r.memberCharge ? r.memberCharge._count.settlements : 0,
      }));

      const dupCheck = new Set<string>();
      for (const s of splitsInput) {
        if (dupCheck.has(s.contactId)) {
          return NextResponse.json(
            { error: "Each contact can appear only once in splits" },
            { status: 400 },
          );
        }
        dupCheck.add(s.contactId);
      }
      const sum = splitsInput.reduce((acc, s) => acc + s.amount, 0);
      if (sum > newAmount + 0.005) {
        return NextResponse.json(
          { error: "Splits cannot exceed transaction total" },
          { status: 400 },
        );
      }
      if (splitsInput.length > 0) {
        const ids = Array.from(dupCheck);
        const found = await prisma.contact.findMany({
          where: { id: { in: ids }, workspaceId: ctx.workspaceId },
          select: { id: true },
        });
        if (found.length !== ids.length) {
          return NextResponse.json(
            { error: "Unknown contact in splits" },
            { status: 400 },
          );
        }
      }
      // Q6: cannot remove or unrecover a split whose charge has settlements.
      // User must "Forgive" from the contact page first.
      const incomingByContact = new Map(splitsInput.map((s) => [s.contactId, s]));
      for (const e of existingSplits) {
        const next = incomingByContact.get(e.contactId);
        const willRemove = !next;
        const willUnrecover = next && e.isRecoverable && !next.isRecoverable;
        const willShrinkBelowSettled =
          next && next.isRecoverable && next.amount + 0.005 < e.chargeSettled;
        if (
          (willRemove || willUnrecover) &&
          e.isRecoverable &&
          e.chargeSettlementCount > 0
        ) {
          return NextResponse.json(
            {
              error:
                "Cannot remove this contact — they have already paid back part of this charge. Forgive it from the contact page instead.",
            },
            { status: 400 },
          );
        }
        if (willShrinkBelowSettled) {
          return NextResponse.json(
            {
              error: "New split amount is less than what has been settled",
            },
            { status: 400 },
          );
        }
      }
    } else if (amountChanged) {
      // Splits not being touched but total amount went down — make sure
      // existing splits still fit under the new total.
      const sum = await prisma.transactionSplit.aggregate({
        where: { transactionId: id },
        _sum: { amount: true },
      });
      const total = Number(sum._sum.amount ?? 0);
      if (total > newAmount + 0.005) {
        return NextResponse.json(
          {
            error:
              "New total is less than the sum of existing splits — adjust the splits first",
          },
          { status: 400 },
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      if (amountChanged && full) {
        // ── Loan EMI: reverse the old payment's principal portion, then
        // apply the new one against the post-reversal balance. Mirrors
        // the delete-then-recreate semantics so foreclose/reopen flags
        // stay consistent.
        if (
          full.loanId &&
          full.loan &&
          full.type === "EXPENSE" &&
          full.kind === "LOAN_PAYMENT"
        ) {
          const rate = full.loan.interestRate
            ? Number(full.loan.interestRate)
            : 0;
          const gst = full.loan.gstOnInterest
            ? Number(full.loan.gstOnInterest)
            : null;
          const freq = (full.loan.frequency ?? "MONTHLY") as LoanFrequency;
          const principal = Number(full.loan.principal);

          const oldPrincipalAddBack = reverseLoanPaymentPrincipal(
            Number(full.loan.outstanding),
            oldAmount,
            rate,
            freq,
          );
          const balanceBeforeNew = Math.min(
            principal,
            Number(full.loan.outstanding) + oldPrincipalAddBack,
          );

          const newSplit = splitPayment(balanceBeforeNew, rate, newAmount, freq, gst);
          const finalOutstanding = Math.max(0, balanceBeforeNew - newSplit.principal);

          const wasForeclosed =
            !full.loan.active && full.loan.foreclosedAt != null;
          const willClose = finalOutstanding === 0;
          await tx.loan.update({
            where: { id: full.loan.id },
            data: {
              outstanding: finalOutstanding,
              active: !willClose,
              foreclosedAt:
                willClose && full.loan.active
                  ? new Date()
                  : !willClose && wasForeclosed
                    ? null
                    : full.loan.foreclosedAt,
            },
          });
        }

        // ── Investment BUY/SELL: shift holdings by the amount delta.
        // BUY adds → positive delta grows the holding; SELL subtracts →
        // positive delta shrinks it. Quantity isn't part of this PATCH
        // surface, so we leave it unchanged.
        if (full.investmentId && full.investment && full.investmentAction) {
          const sign = full.investmentAction === "BUY" ? 1 : -1;
          const delta = newAmount - oldAmount;
          const newInvAmount = Math.max(
            0,
            Number(full.investment.amount) + sign * delta,
          );
          await tx.investment.update({
            where: { id: full.investment.id },
            data: { amount: newInvAmount },
          });
        }

        // ── Linked logs store their own amount. Keep them in sync so
        // worker/livestock reports don't diverge from the ledger.
        if (full.wagePayment) {
          await tx.wagePayment.update({
            where: { id: full.wagePayment.id },
            data: { amount: newAmount },
          });
        }
        if (full.feedLog) {
          await tx.feedLog.update({
            where: { id: full.feedLog.id },
            data: { amount: newAmount },
          });
        }
        if (full.vaccinationLog) {
          await tx.vaccinationLog.update({
            where: { id: full.vaccinationLog.id },
            data: { cost: newAmount },
          });
        }
        if (full.livestockEvent && full.livestockEvent.count > 0) {
          // unitValue is per-head; spread the new amount evenly.
          await tx.livestockEvent.update({
            where: { id: full.livestockEvent.id },
            data: { unitValue: newAmount / full.livestockEvent.count },
          });
        }
      }

      // Apply the splits diff (Slice 2). After this block, `finalSplitState`
      // tells us how to denormalise the legacy fields on the Transaction row.
      let finalSplitState: {
        contactId: string;
        isRecoverable: boolean;
        chargeId: string | null;
      }[] | null = null;
      if (splitsInput !== undefined) {
        const incomingByContact = new Map(splitsInput.map((s) => [s.contactId, s]));
        const existingByContact = new Map(existingSplits.map((e) => [e.contactId, e]));

        // Removed contacts: delete the split + (delete charge if untouched).
        for (const e of existingSplits) {
          if (incomingByContact.has(e.contactId)) continue;
          await tx.transactionSplit.delete({ where: { id: e.id } });
          if (e.memberChargeId && e.chargeSettlementCount === 0) {
            await tx.memberCharge.delete({ where: { id: e.memberChargeId } });
          }
        }

        const finalRows: {
          contactId: string;
          isRecoverable: boolean;
          chargeId: string | null;
        }[] = [];

        for (const s of splitsInput) {
          const existing = existingByContact.get(s.contactId);
          if (!existing) {
            // New split row.
            let chargeId: string | null = null;
            if (s.isRecoverable) {
              const mc = await tx.memberCharge.create({
                data: {
                  workspaceId: ctx.workspaceId,
                  beneficiaryContactId: s.contactId,
                  amount: s.amount,
                  status: MemberChargeStatus.OUTSTANDING,
                },
              });
              chargeId = mc.id;
            }
            await tx.transactionSplit.create({
              data: {
                workspaceId: ctx.workspaceId,
                transactionId: id,
                contactId: s.contactId,
                amount: s.amount,
                sharePercent: s.sharePercent ?? null,
                isRecoverable: s.isRecoverable,
                memberChargeId: chargeId,
                notes: s.notes ?? null,
              },
            });
            finalRows.push({
              contactId: s.contactId,
              isRecoverable: s.isRecoverable,
              chargeId,
            });
            continue;
          }
          // Existing split — patch as needed.
          let chargeId = existing.memberChargeId;
          if (s.isRecoverable && !existing.isRecoverable) {
            // Newly recoverable — create the charge.
            const mc = await tx.memberCharge.create({
              data: {
                workspaceId: ctx.workspaceId,
                beneficiaryContactId: s.contactId,
                amount: s.amount,
                status: MemberChargeStatus.OUTSTANDING,
              },
            });
            chargeId = mc.id;
          } else if (!s.isRecoverable && existing.isRecoverable && existing.memberChargeId) {
            // Was recoverable, now isn't — safe to delete the charge here
            // because we rejected up-front if any settlements existed.
            await tx.memberCharge.delete({ where: { id: existing.memberChargeId } });
            chargeId = null;
          } else if (s.isRecoverable && chargeId && s.amount !== existing.amount) {
            // Amount changed on an existing recoverable charge — update + recompute status.
            const settled = existing.chargeSettled;
            const status: MemberChargeStatus =
              settled <= 0
                ? MemberChargeStatus.OUTSTANDING
                : settled + 0.005 >= s.amount
                  ? MemberChargeStatus.SETTLED
                  : MemberChargeStatus.PARTIAL;
            await tx.memberCharge.update({
              where: { id: chargeId },
              data: { amount: s.amount, status },
            });
          }
          await tx.transactionSplit.update({
            where: { id: existing.id },
            data: {
              amount: s.amount,
              sharePercent: s.sharePercent ?? null,
              isRecoverable: s.isRecoverable,
              memberChargeId: chargeId,
              notes: s.notes ?? null,
            },
          });
          finalRows.push({
            contactId: s.contactId,
            isRecoverable: s.isRecoverable,
            chargeId,
          });
        }
        finalSplitState = finalRows;
      }

      // Derive denormalised beneficiary fields from the post-diff split set.
      // 1-row split → primary beneficiary; multi-row → null (Q5).
      const derivedBeneficiary =
        finalSplitState && finalSplitState.length === 1
          ? finalSplitState[0].contactId
          : finalSplitState && finalSplitState.length > 1
            ? null
            : undefined;
      const derivedChargeType: MemberChargeType | undefined = finalSplitState
        ? finalSplitState.length === 0
          ? MemberChargeType.NONE
          : finalSplitState.some((r) => r.isRecoverable)
            ? MemberChargeType.RECOVERABLE
            : MemberChargeType.GIFT
        : undefined;

      await tx.transaction.update({
        where: { id },
        data: {
          amount: newAmount,
          description: parsed.data.description ?? t.description,
          date: parsed.data.date ? new Date(parsed.data.date) : t.date,
          categoryId:
            parsed.data.categoryId === undefined
              ? t.categoryId
              : parsed.data.categoryId,
          beneficiaryContactId:
            derivedBeneficiary !== undefined
              ? derivedBeneficiary
              : parsed.data.beneficiaryContactId === undefined
                ? t.beneficiaryContactId
                : parsed.data.beneficiaryContactId,
          memberChargeType:
            derivedChargeType !== undefined
              ? derivedChargeType
              : parsed.data.memberChargeType !== undefined
                ? (parsed.data.memberChargeType as MemberChargeType)
                : t.memberChargeType,
          vehicleId:
            parsed.data.vehicleId === undefined ? t.vehicleId : parsed.data.vehicleId,
          claimId:
            parsed.data.claimId === undefined ? t.claimId : parsed.data.claimId,
          hospitalizationId:
            parsed.data.hospitalizationId === undefined
              ? t.hospitalizationId
              : parsed.data.hospitalizationId,
          hospitalizationStage:
            parsed.data.hospitalizationStage === undefined
              ? t.hospitalizationStage
              : parsed.data.hospitalizationStage,
          eventId:
            parsed.data.eventId === undefined ? t.eventId : parsed.data.eventId,
          fuelQuantity:
            parsed.data.fuelQuantity === undefined
              ? t.fuelQuantity
              : parsed.data.fuelQuantity,
          fuelUnit:
            parsed.data.fuelUnit === undefined
              ? t.fuelUnit
              : parsed.data.fuelUnit,
          fuelOdometer:
            parsed.data.fuelOdometer === undefined
              ? t.fuelOdometer
              : parsed.data.fuelOdometer,
          goldForm:
            parsed.data.goldForm === undefined ? t.goldForm : parsed.data.goldForm,
          editNote: parsed.data.editNote ?? null,
          editedAt: new Date(),
          editedByUserId: ctx.userId,
        },
      });
    });

    return NextResponse.json({ id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("transactions", "write");
    const session = await auth();
    const { id } = await context.params;
    const loaded = await loadOwnership(id);
    if (!loaded || loaded.transaction.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, loaded.ownership)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
// Edit-window check. DELETE uses ?force=1 since there's no body.
    const force =
      new URL(request.url).searchParams.get("force") === "1";
    const lock = await checkTransactionEditAllowed({
      transaction: {
        id: loaded.transaction.id,
        date: loaded.transaction.date,
        accountId: loaded.transaction.accountId,
        workspaceId: loaded.transaction.workspaceId,
        loanId: loaded.transaction.loanId,
        type: loaded.transaction.type,
        kind: loaded.transaction.kind,
      },
      role: ctx.role,
      force,
    });
    if (!lock.ok) {
      return NextResponse.json(
        { error: lock.message, canForce: lock.canForce },
        { status: lock.status },
      );
    }
    if (loaded.transaction.transferId) {
      return NextResponse.json(
        { error: "Delete the transfer instead, not its leg." },
        { status: 400 }
      );
    }
    // A loan disbursement INCOME is created together with its Loan
    // record. Removing it in isolation leaves the loan dangling without
    // funds — make the user delete the loan instead.
    if (
      loaded.transaction.loanId &&
      loaded.transaction.type === "INCOME" &&
      loaded.transaction.kind === "LOAN_PAYMENT"
    ) {
      return NextResponse.json(
        { error: "Delete the loan to remove its disbursement." },
        { status: 400 }
      );
    }

    // Pull every side-effect relation in one round-trip so the reversal
    // block below has the data it needs without follow-up queries.
    const t = await prisma.transaction.findUniqueOrThrow({
      where: { id },
      include: {
        loan: true,
        investment: true,
        leaseSchedule: true,
        wagePayment: true,
        livestockEvent: true,
        feedLog: true,
        vaccinationLog: true,
        reminderConfirmation: true,
      },
    });

    await prisma.$transaction(async (tx) => {
      // ── Loan EMI repayment: add the principal portion back to the
      // loan's outstanding and re-open it if this payment had foreclosed
      // it. Closed-form inverse of splitPayment — accurate for the
      // common case where the original split wasn't manually overridden.
      if (
        t.loanId &&
        t.loan &&
        t.type === "EXPENSE" &&
        t.kind === "LOAN_PAYMENT"
      ) {
        const principalAddBack = reverseLoanPaymentPrincipal(
          Number(t.loan.outstanding),
          Number(t.amount),
          t.loan.interestRate ? Number(t.loan.interestRate) : 0,
          (t.loan.frequency ?? "MONTHLY") as LoanFrequency
        );
        const newOutstanding = Math.min(
          Number(t.loan.principal),
          Number(t.loan.outstanding) + principalAddBack
        );
        const wasForeclosedByThis =
          !t.loan.active && t.loan.foreclosedAt != null;
        await tx.loan.update({
          where: { id: t.loan.id },
          data: {
            outstanding: newOutstanding,
            ...(wasForeclosedByThis && newOutstanding > 0
              ? { active: true, foreclosedAt: null }
              : {}),
          },
        });
      }

      // ── Investment BUY/SELL: undo the holdings change made when this
      // transaction was posted. BUY added → reverse subtracts; SELL
      // subtracted → reverse adds.
      if (t.investmentId && t.investment && t.investmentAction) {
        const sign = t.investmentAction === "BUY" ? -1 : 1;
        const newAmount = Math.max(
          0,
          Number(t.investment.amount) + sign * Number(t.amount)
        );
        const qtyDelta = t.investmentQty ? Number(t.investmentQty) : 0;
        const newQty =
          t.investment.quantity == null && qtyDelta === 0
            ? null
            : Math.max(
                0,
                Number(t.investment.quantity ?? 0) + sign * qtyDelta
              );
        await tx.investment.update({
          where: { id: t.investment.id },
          data: { amount: newAmount, quantity: newQty },
        });
      }

      // ── Lease schedule: a confirmed instalment becomes UPCOMING again.
      // The leaseScheduleId FK on the txn auto-clears via SetNull on
      // delete, but the schedule's status is decoupled — reset it.
      if (t.leaseScheduleId) {
        await tx.leasePaymentSchedule.update({
          where: { id: t.leaseScheduleId },
          data: { status: ReminderStatus.UPCOMING },
        });
      }

      // ── Investment reminder: the reminder pointed at this txn as its
      // confirmation. Reopen it so the user can confirm again.
      if (t.reminderConfirmation) {
        await tx.investmentReminder.update({
          where: { id: t.reminderConfirmation.id },
          data: { status: ReminderStatus.UPCOMING },
        });
      }

      // ── Log-style relations exist *because* of this transaction. With
      // the txn gone they'd become orphaned rows that no longer
      // represent any money movement; drop them.
      if (t.wagePayment) {
        await tx.wagePayment.delete({ where: { id: t.wagePayment.id } });
      }
      if (t.livestockEvent) {
        await tx.livestockEvent.delete({ where: { id: t.livestockEvent.id } });
      }
      if (t.feedLog) {
        await tx.feedLog.delete({ where: { id: t.feedLog.id } });
      }
      if (t.vaccinationLog) {
        await tx.vaccinationLog.delete({ where: { id: t.vaccinationLog.id } });
      }

      // ── Member charges: iterate every split's linked charge.
      // - WRITTEN_OFF / SETTLED → leave alone (closed loop, user kept the
      //   audit trail intentionally).
      // - OUTSTANDING / PARTIAL with no settlements → delete (nothing else
      //   refers to it now that the transaction is gone).
      // - OUTSTANDING / PARTIAL with settlements → mark WRITTEN_OFF so the
      //   settlements remain attributable.
      // TransactionSplit rows cascade-delete with the transaction itself.
      const splitCharges = await tx.transactionSplit.findMany({
        where: { transactionId: id },
        select: { memberChargeId: true },
      });
      const chargeIds = new Set<string>();
      for (const s of splitCharges) {
        if (s.memberChargeId) chargeIds.add(s.memberChargeId);
      }
      for (const chargeId of chargeIds) {
        const c = await tx.memberCharge.findUnique({
          where: { id: chargeId },
          select: {
            status: true,
            _count: { select: { settlements: true } },
          },
        });
        if (!c) continue;
        if (
          c.status === MemberChargeStatus.WRITTEN_OFF ||
          c.status === MemberChargeStatus.SETTLED
        ) {
          continue;
        }
        if (c._count.settlements === 0) {
          await tx.memberCharge.delete({ where: { id: chargeId } });
        } else {
          await tx.memberCharge.update({
            where: { id: chargeId },
            data: { status: MemberChargeStatus.WRITTEN_OFF },
          });
        }
      }

      // Archive any TRANSACTION_RECEIPT attachments tied to this txn
      // before the row goes away — the polymorphic Attachment FK isn't
      // cascaded by Prisma, so without this they'd orphan in S3 + DB.
      await archiveAttachmentsForOwner({
        workspaceId: ctx.workspaceId,
        ownerKind: "TRANSACTION_RECEIPT",
        ownerId: id,
        userId: ctx.userId,
        tx,
      });
      await tx.transaction.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
