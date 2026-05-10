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
import { lockErrorMessage } from "@/lib/investment-lock";

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
      // Surface the linked investment's lock so PATCH/DELETE can enforce
      // it before allowing a per-split edit. Without this check Members
      // could bypass `Investment.lockedUntil` by deleting individual
      // split transactions directly.
      investment: { select: { lockedUntil: true } },
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
    investmentLock: t.investment ? { lockedUntil: t.investment.lockedUntil } : null,
  };
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
    if (loaded.investmentLock) {
      const lockMsg = lockErrorMessage(loaded.investmentLock, ctx.role, "edit");
      if (lockMsg) return NextResponse.json({ error: lockMsg }, { status: 423 });
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
            parsed.data.beneficiaryContactId === undefined
              ? t.beneficiaryContactId
              : parsed.data.beneficiaryContactId,
          memberChargeType:
            parsed.data.memberChargeType !== undefined
              ? (parsed.data.memberChargeType as MemberChargeType)
              : t.memberChargeType,
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
    if (loaded.investmentLock) {
      const lockMsg = lockErrorMessage(loaded.investmentLock, ctx.role, "delete");
      if (lockMsg) return NextResponse.json({ error: lockMsg }, { status: 423 });
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

      // ── Member charge: pre-existing behaviour. Drop the charge if no
      // settlements yet, otherwise mark it written-off.
      if (t.memberChargeId) {
        const settlements = await tx.memberChargeSettlement.count({
          where: { chargeId: t.memberChargeId },
        });
        if (settlements === 0) {
          await tx.memberCharge.delete({
            where: { id: t.memberChargeId },
          });
        } else {
          await tx.memberCharge.update({
            where: { id: t.memberChargeId },
            data: { status: MemberChargeStatus.WRITTEN_OFF },
          });
        }
      }

      await tx.transaction.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
