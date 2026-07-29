import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { utilityProviderUpdateSchema } from "@/lib/validators-domain";
import { canModifyRecord } from "@/lib/permissions";
import { initialNextBillDate } from "@/lib/bill-schedule";
import { resyncPrepaidReminder } from "@/lib/prepaid-reminder";
import {
  ReminderKind,
  ReminderStatus,
  UtilityAmountMode,
  UtilityBillCycle,
  UtilityKind,
  UtilityProviderStatus,
} from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[utility-providers/[id]]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("bills", "read");
    const { id } = await context.params;
    const p = await prisma.utilityProvider.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, name: true, kind: true } },
        card: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
      },
    });
    if (!p || p.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      provider: {
        id: p.id,
        kind: p.kind,
        providerName: p.providerName,
        connectionNumber: p.connectionNumber,
        addressLine: p.addressLine,
        accountId: p.accountId,
        cardId: p.cardId,
        account: p.account,
        card: p.card,
        owner: p.owner,
        autoPay: p.autoPay,
        autoPayLeadDays: p.autoPayLeadDays,
        defaultDueDay: p.defaultDueDay,
        gracePeriodDays: p.gracePeriodDays,
        recurring: p.recurring,
        billingCycle: p.billingCycle,
        billingDay: p.billingDay,
        cycleVaries: p.cycleVaries,
        amountMode: p.amountMode,
        defaultAmount: p.defaultAmount != null ? Number(p.defaultAmount) : null,
        nextBillDate: p.nextBillDate?.toISOString() ?? null,
        prepaid: p.prepaid,
        validUntil: p.validUntil?.toISOString() ?? null,
        rechargeValidityDays: p.rechargeValidityDays,
        advanceBalance: Number(p.advanceBalance),
        status: p.status,
        notes: p.notes,
      },
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("bills", "write");
    const session = await auth();
    const { id } = await context.params;
    const existing = await prisma.utilityProvider.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, existing)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await request.json();
    const parsed = utilityProviderUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const d = parsed.data;

    // Prepaid forces recurrence/autopay off — the two billing modes are
    // mutually exclusive (a prepaid connection is paid up front, never
    // generating a bill). Effective values merge the patch over existing.
    const effectivePrepaid = d.prepaid ?? existing.prepaid;

    // Recompute the generator cursor (`nextBillDate`) when recurrence is
    // toggled or the billing day moves.
    const effectiveRecurring = effectivePrepaid
      ? false
      : (d.recurring ?? existing.recurring);
    const effectiveBillingDay =
      d.billingDay !== undefined ? d.billingDay : existing.billingDay;
    let nextBillDate: Date | null | undefined = undefined; // undefined = leave as-is
    if (!effectiveRecurring) {
      // Turned off (or stays off): clear the cursor so nothing generates.
      nextBillDate = existing.nextBillDate ? null : undefined;
    } else {
      const justEnabled = !existing.recurring;
      const dayChanged =
        d.billingDay !== undefined && d.billingDay !== existing.billingDay;
      if (justEnabled || existing.nextBillDate == null || dayChanged) {
        nextBillDate = initialNextBillDate(
          new Date(),
          effectiveBillingDay ?? 1,
        );
      }
    }
    // Persist a sensible billing day when recurrence is on but none set.
    const billingDayToStore =
      effectiveRecurring && effectiveBillingDay == null
        ? 1
        : d.billingDay === undefined
          ? undefined
          : d.billingDay;

    // Resolve the new validity date. `validUntil` is only meaningful for a
    // prepaid provider — turning prepaid off clears it (and its reminder).
    let newValidUntil: Date | null = existing.validUntil;
    if (d.validUntil !== undefined) {
      if (!d.validUntil || !d.validUntil.trim()) {
        newValidUntil = null;
      } else {
        const v = new Date(d.validUntil);
        if (Number.isNaN(v.getTime())) {
          return NextResponse.json(
            { error: "Invalid validity date" },
            { status: 400 },
          );
        }
        v.setUTCHours(0, 0, 0, 0);
        newValidUntil = v;
      }
    }
    if (!effectivePrepaid) newValidUntil = null;

    const sameDate = (a: Date | null, b: Date | null) =>
      (a?.getTime() ?? null) === (b?.getTime() ?? null);
    const validityChanged = !sameDate(newValidUntil, existing.validUntil);

    await prisma.$transaction(async (tx) => {
      await tx.utilityProvider.update({
        where: { id },
        data: {
          kind: (d.kind as UtilityKind | undefined) ?? undefined,
          providerName: d.providerName ?? undefined,
          connectionNumber: d.connectionNumber === undefined ? undefined : d.connectionNumber,
          addressLine: d.addressLine === undefined ? undefined : d.addressLine,
          accountId: d.accountId === undefined ? undefined : d.accountId,
          cardId: d.cardId === undefined ? undefined : d.cardId,
          autoPay: effectivePrepaid
            ? false
            : (d.autoPay === undefined ? undefined : d.autoPay),
          autoPayLeadDays: d.autoPayLeadDays === undefined ? undefined : d.autoPayLeadDays,
          defaultDueDay:
            d.defaultDueDay === undefined ? undefined : d.defaultDueDay,
          gracePeriodDays:
            d.gracePeriodDays === undefined ? undefined : d.gracePeriodDays,
          recurring: effectivePrepaid
            ? false
            : (d.recurring === undefined ? undefined : d.recurring),
          billingCycle:
            (d.billingCycle as UtilityBillCycle | undefined) ?? undefined,
          billingDay: billingDayToStore,
          // Variable cadence only means anything for a provider that
          // generates — turning recurrence off clears it too.
          cycleVaries: effectiveRecurring
            ? (d.cycleVaries === undefined ? undefined : d.cycleVaries)
            : (existing.cycleVaries ? false : undefined),
          amountMode: (d.amountMode as UtilityAmountMode | undefined) ?? undefined,
          defaultAmount:
            d.defaultAmount === undefined ? undefined : d.defaultAmount,
          nextBillDate,
          prepaid: d.prepaid === undefined ? undefined : d.prepaid,
          validUntil: validityChanged ? newValidUntil : undefined,
          rechargeValidityDays: !effectivePrepaid
            ? (existing.rechargeValidityDays != null ? null : undefined)
            : (d.rechargeValidityDays === undefined
                ? undefined
                : d.rechargeValidityDays),
          status: (d.status as UtilityProviderStatus | undefined) ?? undefined,
          notes: d.notes === undefined ? undefined : d.notes,
        },
      });
      // Re-point the validity reminder whenever the expiry moved (or was
      // cleared by turning prepaid off). Mirrors the vehicle-doc resync.
      if (validityChanged) {
        await resyncPrepaidReminder(tx, {
          workspaceId: ctx.workspaceId,
          providerId: id,
          validUntil: newValidUntil,
        });
      }
      // A "check for the bill" prompt only makes sense while the provider
      // is on a variable cadence. Once it isn't (cadence fixed, recurrence
      // off, prepaid), any open prompt is orphaned — clear it rather than
      // leave a reminder nothing will ever satisfy.
      const stillVaries =
        effectiveRecurring &&
        (d.cycleVaries === undefined ? existing.cycleVaries : d.cycleVaries);
      if (existing.cycleVaries && !stillVaries) {
        await tx.investmentReminder.deleteMany({
          where: {
            utilityProviderId: id,
            kind: ReminderKind.UTILITY_BILL_EXPECTED,
            status: ReminderStatus.UPCOMING,
          },
        });
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}

/**
 * Soft-deactivate by default. Pass `?hard=1` to attempt a hard delete —
 * only allowed when no bills and no linked transactions exist (advances,
 * bill payments, or prepaid recharges) AND advanceBalance == 0. Otherwise
 * falls back to soft so ledger history keeps its provider link.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("bills", "write");
    const session = await auth();
    const { id } = await context.params;
    const p = await prisma.utilityProvider.findUnique({ where: { id } });
    if (!p || p.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, p)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const hard = url.searchParams.get("hard") === "1";
    if (hard) {
      const [billCount, txnCount] = await Promise.all([
        prisma.utilityBill.count({ where: { providerId: id } }),
        // Any linked transaction — advance, bill payment, or prepaid
        // recharge — is history worth preserving, so block the hard delete.
        prisma.transaction.count({ where: { utilityProviderId: id } }),
      ]);
      if (
        billCount === 0 &&
        txnCount === 0 &&
        Number(p.advanceBalance) === 0
      ) {
        await prisma.utilityProvider.delete({ where: { id } });
        return NextResponse.json({ ok: true, mode: "hard" });
      }
      // Fall through to soft on conflict.
    }

    await prisma.$transaction(async (tx) => {
      await tx.utilityProvider.update({
        where: { id },
        data: { status: UtilityProviderStatus.INACTIVE },
      });
      // A deactivated prepaid connection shouldn't keep nagging to
      // recharge — drop its live validity reminder (validUntil: null
      // deletes the UPCOMING reminder without creating a new one).
      if (p.prepaid) {
        await resyncPrepaidReminder(tx, {
          workspaceId: ctx.workspaceId,
          providerId: id,
          validUntil: null,
        });
      }
    });
    return NextResponse.json({ ok: true, mode: "soft" });
  } catch (e) {
    return err(e);
  }
}
